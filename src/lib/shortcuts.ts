import { writable } from 'svelte/store';

export type ShortcutRecord = {
    actionId: string;
    shortcut: string;
    label: string;
    locked: boolean;
    updatedAt: number;
};

export type ShortcutConflict = {
    actionId: string;
    label: string;
    shortcut: string;
};

const DATABASE_NAME = 'cs2-replay-viewer';
const DATABASE_VERSION = 1;
const BINDINGS_STORE = 'shortcut_bindings';
const META_STORE = 'meta';
const DEFAULTS_META_KEY = 'shortcut-defaults-v1';
const DRAWING_DEFAULT_META_KEY = 'shortcut-drawing-default-v1';

export const shortcutBindingsStore = writable<Record<string, string>>({});

const LOCKED_SHORTCUTS: ShortcutRecord[] = [
    { actionId: 'system.map-zoom-in', shortcut: 'MOUSE_WHEEL_UP', label: 'Map zoom in', locked: true, updatedAt: 0 },
    { actionId: 'system.map-zoom-out', shortcut: 'MOUSE_WHEEL_DOWN', label: 'Map zoom out', locked: true, updatedAt: 0 },
];

const DEFAULT_SHORTCUTS: ShortcutRecord[] = [
    { actionId: 'playback.toggle', shortcut: 'SPACE', label: 'Play / pause', locked: false, updatedAt: 0 },
];

const DRAWING_DEFAULT_SHORTCUT: ShortcutRecord = {
    actionId: 'drawing.setup',
    shortcut: 'SHIFT',
    label: 'Drawing Setup',
    locked: false,
    updatedAt: 0,
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Shortcut database request failed'));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('Shortcut database transaction was aborted'));
        transaction.onerror = () => reject(transaction.error ?? new Error('Shortcut database transaction failed'));
    });
}

function openShortcutDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(BINDINGS_STORE)) {
                const bindings = database.createObjectStore(BINDINGS_STORE, { keyPath: 'actionId' });
                bindings.createIndex('shortcut', 'shortcut', { unique: true });
            }
            if (!database.objectStoreNames.contains(META_STORE)) {
                database.createObjectStore(META_STORE, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open the shortcut database'));
    });
}

async function seedShortcutDatabase(database: IDBDatabase): Promise<void> {
    const transaction = database.transaction([BINDINGS_STORE, META_STORE], 'readwrite');
    const bindings = transaction.objectStore(BINDINGS_STORE);
    const meta = transaction.objectStore(META_STORE);
    const defaultsSeeded = await requestResult(meta.get(DEFAULTS_META_KEY));
    const drawingDefaultSeeded = await requestResult(meta.get(DRAWING_DEFAULT_META_KEY));

    for (const record of LOCKED_SHORTCUTS) {
        bindings.put({ ...record, updatedAt: Date.now() });
    }

    if (!defaultsSeeded) {
        for (const record of DEFAULT_SHORTCUTS) {
            bindings.put({ ...record, updatedAt: Date.now() });
        }
        meta.put({ key: DEFAULTS_META_KEY, value: true });
    }

    if (!drawingDefaultSeeded) {
        bindings.delete('system.draw-left');
        bindings.delete('system.draw-right');
        bindings.put({ ...DRAWING_DEFAULT_SHORTCUT, updatedAt: Date.now() });
        meta.put({ key: DRAWING_DEFAULT_META_KEY, value: true });
    }

    await transactionDone(transaction);
}

export async function loadShortcutRecords(): Promise<ShortcutRecord[]> {
    const database = await openShortcutDatabase();
    try {
        await seedShortcutDatabase(database);
        const transaction = database.transaction(BINDINGS_STORE, 'readonly');
        const records = await requestResult(transaction.objectStore(BINDINGS_STORE).getAll());
        await transactionDone(transaction);
        return records as ShortcutRecord[];
    } finally {
        database.close();
    }
}

export async function assignShortcut(
    actionId: string,
    label: string,
    shortcut: string
): Promise<ShortcutRecord> {
    const database = await openShortcutDatabase();
    try {
        const transaction = database.transaction(BINDINGS_STORE, 'readwrite');
        const store = transaction.objectStore(BINDINGS_STORE);
        const existing = await requestResult(store.index('shortcut').get(shortcut)) as ShortcutRecord | undefined;
        if (existing && existing.actionId !== actionId) {
            transaction.abort();
            throw { actionId: existing.actionId, label: existing.label, shortcut } satisfies ShortcutConflict;
        }

        const current = await requestResult(store.get(actionId)) as ShortcutRecord | undefined;
        if (current?.locked) {
            transaction.abort();
            throw new Error('This shortcut is fixed and cannot be changed');
        }

        const record: ShortcutRecord = { actionId, label, shortcut, locked: false, updatedAt: Date.now() };
        store.put(record);
        await transactionDone(transaction);
        return record;
    } finally {
        database.close();
    }
}

export async function removeShortcut(actionId: string): Promise<void> {
    const database = await openShortcutDatabase();
    try {
        const transaction = database.transaction(BINDINGS_STORE, 'readwrite');
        const store = transaction.objectStore(BINDINGS_STORE);
        const current = await requestResult(store.get(actionId)) as ShortcutRecord | undefined;
        if (current?.locked) {
            transaction.abort();
            throw new Error('This shortcut is fixed and cannot be removed');
        }
        store.delete(actionId);
        await transactionDone(transaction);
    } finally {
        database.close();
    }
}

export async function replaceShortcutRecords(importedRecords: readonly ShortcutRecord[]): Promise<ShortcutRecord[]> {
    const recordsByAction = new Map<string, ShortcutRecord>();
    const actionsByShortcut = new Map<string, string>();

    for (const imported of importedRecords) {
        if (
            !imported ||
            typeof imported.actionId !== 'string' ||
            typeof imported.shortcut !== 'string' ||
            typeof imported.label !== 'string' ||
            !imported.actionId ||
            !imported.shortcut ||
            imported.locked ||
            imported.actionId.startsWith('system.')
        ) {
            continue;
        }
        const duplicateAction = actionsByShortcut.get(imported.shortcut);
        if (duplicateAction && duplicateAction !== imported.actionId) {
            throw new Error(`The imported shortcut ${imported.shortcut} is assigned more than once`);
        }
        actionsByShortcut.set(imported.shortcut, imported.actionId);
        recordsByAction.set(imported.actionId, {
            actionId: imported.actionId,
            shortcut: imported.shortcut,
            label: imported.label,
            locked: false,
            updatedAt: Date.now(),
        });
    }

    for (const locked of LOCKED_SHORTCUTS) {
        const conflictingAction = actionsByShortcut.get(locked.shortcut);
        if (conflictingAction) {
            throw new Error(`${locked.shortcut} is reserved for ${locked.label}`);
        }
    }

    const database = await openShortcutDatabase();
    try {
        await seedShortcutDatabase(database);
        const transaction = database.transaction(BINDINGS_STORE, 'readwrite');
        const store = transaction.objectStore(BINDINGS_STORE);
        store.clear();
        for (const locked of LOCKED_SHORTCUTS) {
            store.put({ ...locked, updatedAt: Date.now() });
        }
        for (const record of recordsByAction.values()) {
            store.put(record);
        }
        await transactionDone(transaction);
        return [...LOCKED_SHORTCUTS, ...recordsByAction.values()];
    } finally {
        database.close();
    }
}

export async function restoreDefaultShortcutRecords(): Promise<ShortcutRecord[]> {
    return replaceShortcutRecords([...DEFAULT_SHORTCUTS, DRAWING_DEFAULT_SHORTCUT]);
}

const MODIFIER_CODES = new Set([
    'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'CapsLock',
]);

function keyToken(code: string, key: string): string | null {
    if (code.startsWith('Key')) return code.slice(3).toUpperCase();
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) {
        const suffix = code.slice(6).toUpperCase();
        const aliases: Record<string, string> = {
            ADD: 'NUM_ADD', SUBTRACT: 'NUM_SUBTRACT', MULTIPLY: 'NUM_MULTIPLY',
            DIVIDE: 'NUM_DIVIDE', DECIMAL: 'NUM_DECIMAL', ENTER: 'NUM_ENTER',
        };
        return aliases[suffix] ?? `NUM_${suffix}`;
    }

    const aliases: Record<string, string> = {
        Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BACKSPACE',
        Delete: 'DELETE', Insert: 'INSERT', Home: 'HOME', End: 'END', PageUp: 'PAGE_UP',
        PageDown: 'PAGE_DOWN', ArrowUp: 'ARROW_UP', ArrowDown: 'ARROW_DOWN',
        ArrowLeft: 'ARROW_LEFT', ArrowRight: 'ARROW_RIGHT', Minus: '-', Equal: '=',
        BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
        Backquote: '`', Comma: ',', Period: '.', Slash: '/',
    };
    if (aliases[code]) return aliases[code];
    if (/^F\d{1,2}$/.test(code)) return code;
    return key.length === 1 ? key.toUpperCase() : code.toUpperCase();
}

function modifierTokens(event: KeyboardEvent | MouseEvent, heldCodes: ReadonlySet<string>): string[] {
    const tokens: string[] = [];
    const keyboardEvent = event instanceof KeyboardEvent ? event : null;
    const altGraph = (keyboardEvent?.getModifierState('AltGraph') ?? false) || (
        heldCodes.has('AltRight') && (heldCodes.has('ControlLeft') || heldCodes.has('ControlRight'))
    );
    if (altGraph) {
        tokens.push('ALT_GR');
    } else {
        if (heldCodes.has('ControlRight')) tokens.push('RIGHT_CTRL');
        else if (event.ctrlKey) tokens.push('CTRL');
        if (event.altKey) tokens.push('ALT');
    }
    if (event.shiftKey) tokens.push('SHIFT');
    if (heldCodes.has('CapsLock')) tokens.push('CAPSLOCK');
    return tokens;
}

function heldKeyTokens(heldCodes: ReadonlySet<string>, excludedCode?: string): string[] {
    return [...heldCodes]
        .filter(code => code !== excludedCode && !MODIFIER_CODES.has(code))
        .map(code => keyToken(code, code))
        .filter((token): token is string => Boolean(token))
        .sort();
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent, heldCodes: ReadonlySet<string>): string | null {
    if (MODIFIER_CODES.has(event.code) || event.key === 'AltGraph') return null;
    const primary = keyToken(event.code, event.key);
    if (!primary) return null;
    return [...modifierTokens(event, heldCodes), ...heldKeyTokens(heldCodes, event.code), primary].join('+');
}

export function modifierShortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
    if (event.code === 'ControlRight') return 'RIGHT_CTRL';
    if (event.code === 'ControlLeft') return 'CTRL';
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') return 'SHIFT';
    if (event.code === 'AltRight' && event.key === 'AltGraph') return 'ALT_GR';
    if (event.code === 'AltLeft' || event.code === 'AltRight') return 'ALT';
    if (event.code === 'CapsLock') return 'CAPSLOCK';
    return null;
}

export function shortcutFromMouseEvent(event: MouseEvent, heldCodes: ReadonlySet<string>): string {
    return [...modifierTokens(event, heldCodes), ...heldKeyTokens(heldCodes), `MOUSE_${event.button + 1}`].join('+');
}

export function shortcutFromWheelEvent(event: WheelEvent, heldCodes: ReadonlySet<string>): string {
    const direction = event.deltaY < 0 ? 'MOUSE_WHEEL_UP' : 'MOUSE_WHEEL_DOWN';
    return [...modifierTokens(event, heldCodes), ...heldKeyTokens(heldCodes), direction].join('+');
}

export function shortcutForDisplay(shortcut: string): string {
    return shortcut.replaceAll('+', ' + ').replaceAll('_', ' ');
}
