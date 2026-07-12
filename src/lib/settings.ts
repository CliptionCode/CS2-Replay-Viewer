const DATABASE_NAME = 'cs2-replay-viewer-settings';
const DATABASE_VERSION = 1;
const STORE_NAME = 'settings';

export type CameraMovementDirection = 'forward' | 'left' | 'backward' | 'right';

export interface ViewerSettings {
  schemaVersion: number;
  cs2GamePath: string;
  cameraMovementKeys: Record<CameraMovementDirection, string>;
  cameraMovementSpeed: number;
  cameraZoomSpeed: number;
}

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
  schemaVersion: 2,
  cs2GamePath: '',
  cameraMovementKeys: {
    forward: 'KeyW',
    left: 'KeyA',
    backward: 'KeyS',
    right: 'KeyD'
  },
  cameraMovementSpeed: 36,
  cameraZoomSpeed: 1
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Settings database request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Settings transaction was aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Settings transaction failed'));
  });
}

function openSettingsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the settings database'));
  });
}

export async function loadViewerSettings(): Promise<ViewerSettings> {
  const database = await openSettingsDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const saved = await requestResult(transaction.objectStore(STORE_NAME).get('viewer')) as Partial<ViewerSettings> | undefined;
    const settings: ViewerSettings = {
      ...DEFAULT_VIEWER_SETTINGS,
      ...saved,
      schemaVersion: DEFAULT_VIEWER_SETTINGS.schemaVersion,
      cameraMovementSpeed: !saved?.schemaVersion && saved?.cameraMovementSpeed === 24
        ? DEFAULT_VIEWER_SETTINGS.cameraMovementSpeed
        : (saved?.cameraMovementSpeed ?? DEFAULT_VIEWER_SETTINGS.cameraMovementSpeed),
      cameraMovementKeys: {
        ...DEFAULT_VIEWER_SETTINGS.cameraMovementKeys,
        ...(saved?.cameraMovementKeys ?? {})
      }
    };
    transaction.objectStore(STORE_NAME).put(settings, 'viewer');
    await transactionDone(transaction);
    return settings;
  } finally {
    database.close();
  }
}

export async function saveViewerSettings(settings: ViewerSettings): Promise<void> {
  const database = await openSettingsDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(settings, 'viewer');
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export function keyCodeForDisplay(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace(/^Arrow/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}
