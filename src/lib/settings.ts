const DATABASE_NAME = 'cs2-replay-viewer-settings';
const DATABASE_VERSION = 1;
const STORE_NAME = 'settings';
const VIEWER_SETTINGS_KEY = 'viewer';
const RELEASE_NOTES_SEEN_KEY = 'release-notes-seen-version';

export type CameraMovementDirection = 'forward' | 'left' | 'backward' | 'right';

export interface ViewerSettings {
  schemaVersion: number;
  cs2GamePath: string;
  cameraMovementKeys: Record<CameraMovementDirection, string>;
  cameraMovementSpeed: number;
  cameraZoomSpeed: number;
  showSightCone: boolean;
  sightConeForSelectedPlayer: boolean;
  sightConeHalfAngle: number;
  sightConeLength: number;
  sightConeTransparencyPercent: number;
  showLineOfSight2D: boolean;
  lineOfSightWidth2D: number;
  lineOfSightLength2D: number;
  showLineOfSight3D: boolean;
  lineOfSightWidth3D: number;
  lineOfSightLength3D: number;
  lineOfSightTransparency3D: number;
  selectedPlayerZoomPercent: number;
  showPlayerUtilities: boolean;
  showPlayerC4: boolean;
  showPlayerDefuseKit: boolean;
  showNoiseCircle: boolean;
  noiseForSelectedPlayer: boolean;
  showCtNoiseCircle: boolean;
  showTNoiseCircle: boolean;
  noiseTransparencyPercent: number;
  enabledNoiseSources: Record<string, boolean>;
  showAllTimelineUtilities: boolean;
  enabledTimelineUtilities: Record<string, boolean>;
  enabledTimelineCombatEvents: Record<string, boolean>;
  showDroppedWeapons: boolean;
  showDroppedUtility: boolean;
  showDroppedC4: boolean;
  showDroppedDefuseKit: boolean;
  leftDrawingColor: string;
  rightDrawingColor: string;
  drawingStrokeWidth: number;
  drawingMode: 'permanent' | 'fade';
  drawingFadeSeconds: number;
}

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
  schemaVersion: 3,
  cs2GamePath: '',
  cameraMovementKeys: {
    forward: 'KeyW',
    left: 'KeyA',
    backward: 'KeyS',
    right: 'KeyD'
  },
  cameraMovementSpeed: 36,
  cameraZoomSpeed: 1,
  showSightCone: true,
  sightConeForSelectedPlayer: false,
  sightConeHalfAngle: 0.68,
  sightConeLength: 75,
  sightConeTransparencyPercent: 84,
  showLineOfSight2D: false,
  lineOfSightWidth2D: 1.6,
  lineOfSightLength2D: 300,
  showLineOfSight3D: true,
  lineOfSightWidth3D: 5,
  lineOfSightLength3D: 650,
  lineOfSightTransparency3D: 0.5,
  selectedPlayerZoomPercent: 250,
  showPlayerUtilities: true,
  showPlayerC4: true,
  showPlayerDefuseKit: true,
  showNoiseCircle: false,
  noiseForSelectedPlayer: false,
  showCtNoiseCircle: true,
  showTNoiseCircle: true,
  noiseTransparencyPercent: 85,
  enabledNoiseSources: {
    running: true,
    jump: true,
    shooting: true,
    falling: true,
    weapon_drop: true,
    utility_drop: true,
    c4_drop: true,
    weapon_reload: true
  },
  showAllTimelineUtilities: false,
  enabledTimelineUtilities: {
    smoke: true,
    flashbang: true,
    hegrenade: true,
    molotov: true,
    decoy: true
  },
  enabledTimelineCombatEvents: {
    kill: true,
    death: true
  },
  showDroppedWeapons: true,
  showDroppedUtility: true,
  showDroppedC4: true,
  showDroppedDefuseKit: true,
  leftDrawingColor: '#3b82f6',
  rightDrawingColor: '#f97316',
  drawingStrokeWidth: 4,
  drawingMode: 'permanent',
  drawingFadeSeconds: 3
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

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function colorValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function booleanRecord(value: unknown, fallback: Record<string, boolean>): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
  const imported = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(fallback).map(([key, defaultValue]) => [key, booleanValue(imported[key], defaultValue)])
  );
}

export function normalizeViewerSettings(value: unknown): ViewerSettings {
  const saved = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ViewerSettings>
    : {};
  const legacyCameraSpeed = !saved.schemaVersion && saved.cameraMovementSpeed === 24;
  const cameraMovementKeys = saved.cameraMovementKeys && typeof saved.cameraMovementKeys === 'object'
    ? saved.cameraMovementKeys
    : {} as Partial<Record<CameraMovementDirection, string>>;

  return {
    schemaVersion: DEFAULT_VIEWER_SETTINGS.schemaVersion,
    cs2GamePath: typeof saved.cs2GamePath === 'string' ? saved.cs2GamePath : DEFAULT_VIEWER_SETTINGS.cs2GamePath,
    cameraMovementKeys: Object.fromEntries(
      Object.entries(DEFAULT_VIEWER_SETTINGS.cameraMovementKeys).map(([direction, defaultCode]) => {
        const importedCode = cameraMovementKeys[direction as CameraMovementDirection];
        return [direction, typeof importedCode === 'string' && importedCode ? importedCode : defaultCode];
      })
    ) as Record<CameraMovementDirection, string>,
    cameraMovementSpeed: legacyCameraSpeed
      ? DEFAULT_VIEWER_SETTINGS.cameraMovementSpeed
      : numberValue(saved.cameraMovementSpeed, DEFAULT_VIEWER_SETTINGS.cameraMovementSpeed, 4, 100),
    cameraZoomSpeed: numberValue(saved.cameraZoomSpeed, DEFAULT_VIEWER_SETTINGS.cameraZoomSpeed, 0.1, 3),
    showSightCone: booleanValue(saved.showSightCone, DEFAULT_VIEWER_SETTINGS.showSightCone),
    sightConeForSelectedPlayer: booleanValue(saved.sightConeForSelectedPlayer, DEFAULT_VIEWER_SETTINGS.sightConeForSelectedPlayer),
    sightConeHalfAngle: numberValue(saved.sightConeHalfAngle, DEFAULT_VIEWER_SETTINGS.sightConeHalfAngle, 0.16, 0.8),
    sightConeLength: numberValue(saved.sightConeLength, DEFAULT_VIEWER_SETTINGS.sightConeLength, 18, 240),
    sightConeTransparencyPercent: numberValue(saved.sightConeTransparencyPercent, DEFAULT_VIEWER_SETTINGS.sightConeTransparencyPercent, 0, 100),
    showLineOfSight2D: booleanValue(saved.showLineOfSight2D, DEFAULT_VIEWER_SETTINGS.showLineOfSight2D),
    lineOfSightWidth2D: numberValue(saved.lineOfSightWidth2D, DEFAULT_VIEWER_SETTINGS.lineOfSightWidth2D, 0.3, 3),
    lineOfSightLength2D: numberValue(saved.lineOfSightLength2D, DEFAULT_VIEWER_SETTINGS.lineOfSightLength2D, 18, 800),
    showLineOfSight3D: booleanValue(saved.showLineOfSight3D, DEFAULT_VIEWER_SETTINGS.showLineOfSight3D),
    lineOfSightWidth3D: numberValue(saved.lineOfSightWidth3D, DEFAULT_VIEWER_SETTINGS.lineOfSightWidth3D, 1, 50),
    lineOfSightLength3D: numberValue(saved.lineOfSightLength3D, DEFAULT_VIEWER_SETTINGS.lineOfSightLength3D, 18, 1100),
    lineOfSightTransparency3D: numberValue(saved.lineOfSightTransparency3D, DEFAULT_VIEWER_SETTINGS.lineOfSightTransparency3D, 0, 0.95),
    selectedPlayerZoomPercent: numberValue(saved.selectedPlayerZoomPercent, DEFAULT_VIEWER_SETTINGS.selectedPlayerZoomPercent, 100, 500),
    showPlayerUtilities: booleanValue(saved.showPlayerUtilities, DEFAULT_VIEWER_SETTINGS.showPlayerUtilities),
    showPlayerC4: booleanValue(saved.showPlayerC4, DEFAULT_VIEWER_SETTINGS.showPlayerC4),
    showPlayerDefuseKit: booleanValue(saved.showPlayerDefuseKit, DEFAULT_VIEWER_SETTINGS.showPlayerDefuseKit),
    showNoiseCircle: booleanValue(saved.showNoiseCircle, DEFAULT_VIEWER_SETTINGS.showNoiseCircle),
    noiseForSelectedPlayer: booleanValue(saved.noiseForSelectedPlayer, DEFAULT_VIEWER_SETTINGS.noiseForSelectedPlayer),
    showCtNoiseCircle: booleanValue(saved.showCtNoiseCircle, DEFAULT_VIEWER_SETTINGS.showCtNoiseCircle),
    showTNoiseCircle: booleanValue(saved.showTNoiseCircle, DEFAULT_VIEWER_SETTINGS.showTNoiseCircle),
    noiseTransparencyPercent: numberValue(saved.noiseTransparencyPercent, DEFAULT_VIEWER_SETTINGS.noiseTransparencyPercent, 0, 100),
    enabledNoiseSources: booleanRecord(saved.enabledNoiseSources, DEFAULT_VIEWER_SETTINGS.enabledNoiseSources),
    showAllTimelineUtilities: booleanValue(saved.showAllTimelineUtilities, DEFAULT_VIEWER_SETTINGS.showAllTimelineUtilities),
    enabledTimelineUtilities: booleanRecord(saved.enabledTimelineUtilities, DEFAULT_VIEWER_SETTINGS.enabledTimelineUtilities),
    enabledTimelineCombatEvents: booleanRecord(saved.enabledTimelineCombatEvents, DEFAULT_VIEWER_SETTINGS.enabledTimelineCombatEvents),
    showDroppedWeapons: booleanValue(saved.showDroppedWeapons, DEFAULT_VIEWER_SETTINGS.showDroppedWeapons),
    showDroppedUtility: booleanValue(saved.showDroppedUtility, DEFAULT_VIEWER_SETTINGS.showDroppedUtility),
    showDroppedC4: booleanValue(saved.showDroppedC4, DEFAULT_VIEWER_SETTINGS.showDroppedC4),
    showDroppedDefuseKit: booleanValue(saved.showDroppedDefuseKit, DEFAULT_VIEWER_SETTINGS.showDroppedDefuseKit),
    leftDrawingColor: colorValue(saved.leftDrawingColor, DEFAULT_VIEWER_SETTINGS.leftDrawingColor),
    rightDrawingColor: colorValue(saved.rightDrawingColor, DEFAULT_VIEWER_SETTINGS.rightDrawingColor),
    drawingStrokeWidth: numberValue(saved.drawingStrokeWidth, DEFAULT_VIEWER_SETTINGS.drawingStrokeWidth, 1, 10),
    drawingMode: saved.drawingMode === 'fade' || saved.drawingMode === 'permanent'
      ? saved.drawingMode
      : DEFAULT_VIEWER_SETTINGS.drawingMode,
    drawingFadeSeconds: numberValue(saved.drawingFadeSeconds, DEFAULT_VIEWER_SETTINGS.drawingFadeSeconds, 1, 6)
  };
}

export async function loadViewerSettings(): Promise<ViewerSettings> {
  const database = await openSettingsDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const saved = await requestResult(transaction.objectStore(STORE_NAME).get(VIEWER_SETTINGS_KEY));
    const settings = normalizeViewerSettings(saved);
    transaction.objectStore(STORE_NAME).put(settings, VIEWER_SETTINGS_KEY);
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
    transaction.objectStore(STORE_NAME).put(normalizeViewerSettings(settings), VIEWER_SETTINGS_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function loadLastSeenReleaseNotesVersion(): Promise<string> {
  const database = await openSettingsDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const version = await requestResult(transaction.objectStore(STORE_NAME).get(RELEASE_NOTES_SEEN_KEY));
    await transactionDone(transaction);
    return typeof version === 'string' ? version : '';
  } finally {
    database.close();
  }
}

export async function saveLastSeenReleaseNotesVersion(version: string): Promise<void> {
  const database = await openSettingsDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(version, RELEASE_NOTES_SEEN_KEY);
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
