<script lang="ts">
import { onMount, tick as flushDom } from 'svelte';
import { browser } from '$app/environment';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { create, fromBinary } from '@bufbuild/protobuf';
import { ReplayDataSchema, MapDataSchema } from '$lib/types/replay/replay_pb';
import type {
    BombEvent,
    KillEvent,
    NadeEvent,
    PlayerFrame,
    PlayerInfo,
    ReplayData,
    RoundData,
    MapData as MapMetadata,
} from '$lib/types/replay/replay_pb';
import { MAP_CANVAS_MARGIN, worldToCanvas } from '$lib/canvas/transforms';
import { TIMELINE_ICON_FILES, equipmentIconPath } from '$lib/equipment-icons';
import MapLayer from '$lib/components/MapLayer.svelte';
import PlayerLayer from '$lib/components/PlayerLayer.svelte';
import NadeLayer from '$lib/components/NadeLayer.svelte';
import DroppedEquipmentLayer from '$lib/components/DroppedEquipmentLayer.svelte';
import KillLayer from '$lib/components/KillLayer.svelte';
import DrawingLayer from '$lib/components/DrawingLayer.svelte';
import Controls from '$lib/components/Controls.svelte';
import ShortcutBinding from '$lib/components/ShortcutBinding.svelte';
import TimeDisplay from '$lib/components/TimeDisplay.svelte';
import RoundNav from '$lib/components/RoundNav.svelte';
import {
    assignShortcut,
    loadShortcutRecords,
    modifierShortcutFromKeyboardEvent,
    removeShortcut,
    shortcutBindingsStore,
    shortcutFromKeyboardEvent,
    shortcutFromMouseEvent,
    shortcutFromWheelEvent,
    shortcutForDisplay,
    type ShortcutConflict,
} from '$lib/shortcuts';
import { DEFAULT_RADAR_MAP, getRadarInfo } from '$lib/maps/radar-info';
import { ReplayScene } from '$lib/renderer/ReplayScene';
import { getMapStatus, mapSceneUrl, prepareMap, validateCs2Folder, type LocalMapStatus } from '$lib/maps/local-map';
import {
    DEFAULT_VIEWER_SETTINGS,
    keyCodeForDisplay,
    loadViewerSettings,
    saveViewerSettings,
    type CameraMovementDirection,
    type ViewerSettings,
} from '$lib/settings';
import {
    getPlaybackStartRound as getReplayPlaybackStartRound,
    getRoundEndDelayTicks,
    getRoundDisplayEndTick,
    getRoundForTick as getReplayRoundForTick,
    getRoundTerminalTick,
} from '$lib/replay/rounds';
import {
    getPlaybackTick,
    notifyPlaybackTickChanged,
    setPlaybackTick,
    setPlaybackTickAndNotify,
} from '$lib/playback-state';

const DEFAULT_RADAR_INFO = getRadarInfo(DEFAULT_RADAR_MAP)!;

function createMapMetadataFromRadarInfo(radarInfo = DEFAULT_RADAR_INFO): MapMetadata {
    return create(MapDataSchema, {
        name: radarInfo.name,
        posX: radarInfo.posX,
        posY: radarInfo.posY,
        scale: radarInfo.scale,
        rotate: radarInfo.rotate,
        zoom: radarInfo.zoom,
        width: radarInfo.width,
        height: radarInfo.height,
    });
}

function fillMapMetadata(m: MapMetadata | undefined, headerMapName?: string): MapMetadata {
    const radarInfo = getRadarInfo(m?.name || headerMapName);
    if (radarInfo) return createMapMetadataFromRadarInfo(radarInfo);

    return create(MapDataSchema, {
        name: m?.name || headerMapName || DEFAULT_RADAR_MAP,
        posX: m?.posX ?? DEFAULT_RADAR_INFO.posX,
        posY: m?.posY ?? DEFAULT_RADAR_INFO.posY,
        scale: m?.scale || DEFAULT_RADAR_INFO.scale,
        rotate: m?.rotate ?? DEFAULT_RADAR_INFO.rotate,
        zoom: m?.zoom ?? DEFAULT_RADAR_INFO.zoom,
        width: m?.width || DEFAULT_RADAR_INFO.width,
        height: m?.height || DEFAULT_RADAR_INFO.height,
    });
}

export let replayData: ReplayData | null = null;
export let mapMetadata: MapMetadata = createMapMetadataFromRadarInfo();
export let isPlaying: boolean = false;

let displayTick: number = 0;
let roundProgressPct: number = 0;
let isLoading = false;
let isMapReady = false;
let replayContainer: HTMLDivElement | null = null;
let playbackSpeed: number = 1;
let rafId: number | null = null;
let playbackRefTick: number = 0;
let playbackRefTime: number = 0;
let lastDisplayUpdateTime: number = 0;

const SPEED_OPTIONS = [0.5, 1, 2, 3];
const DISPLAY_UPDATE_INTERVAL_MS = 100;
const TEAM_T = 2;
const TEAM_CT = 3;
const TEAM_T_COLOR = '#f97316';
const TEAM_CT_COLOR = '#3b82f6';
const DEAD_PLAYER_COLOR = '#6b7280';
const DEFAULT_SIGHT_CONE_LENGTH = 75;
const DEFAULT_SIGHT_CONE_HALF_ANGLE = 0.68;
const EVENT_SEEK_LEAD_SECONDS = 2;
const DEFAULT_LINE_OF_SIGHT_LENGTH = 300;
const DEFAULT_LINE_OF_SIGHT_WIDTH = 1.6;
const DEFAULT_3D_LINE_OF_SIGHT_LENGTH = 500;
const DEFAULT_3D_LINE_OF_SIGHT_WIDTH = 5;
const DEFAULT_SELECTED_PLAYER_ZOOM_PERCENT = 250;
const MAX_MOUSE_VIEWPORT_ZOOM_SCALE = 5;
const MAP_PAN_VIEWPORT_PADDING = 0.5;
const MAP_PAN_MAP_PADDING = 0.25;
const PLAYER_DOT_CLICK_RADIUS = 12;
const DEFAULT_DRAWING_STROKE_WIDTH = 4;
const DEFAULT_DRAWING_FADE_SECONDS = 3;
const TOAST_DURATION_MS = 2600;
const DEFAULT_BOMB_TIME_SECONDS = 40;
const DEFAULT_PLANT_SECONDS = 3.2;
const DEFUSE_SECONDS_WITH_KIT = 5;
const DEFUSE_SECONDS_WITHOUT_KIT = 10;
const TIMELINE_MIN_HEIGHT = 86;
const TIMELINE_FIXED_CONTENT_HEIGHT = 38;
const TIMELINE_MARKER_ICON_SIZE = 24;
const TIMELINE_MARKER_BUTTON_SIZE = 28;
const TIMELINE_MARKER_LANE_GAP = 6;
const TIMELINE_MARKER_BOTTOM_PADDING = 4;
const TIMELINE_MARKER_LANE_PITCH = TIMELINE_MARKER_BUTTON_SIZE + TIMELINE_MARKER_LANE_GAP;
const TIMELINE_MARKER_HORIZONTAL_GAP = 4;
const TIMELINE_HORIZONTAL_PADDING = 40;
const NADE_MATCH_DISTANCE_UNITS = 240;
const NADE_MATCH_TICK_WINDOW = 768;
const SMOKE_MATCH_TICK_WINDOW = 1536;
const KILL_FEED_LEFT_OFFSET = 312;
const DONATION_URL = 'https://paypal.me/cliption';
const NADE_SINGLE_CLICK_DELAY_MS = 500;
const DEAD_ICON_SINGLE_CLICK_DELAY_MS = 500;
const DEAD_PLAYER_SEEK_LEAD_SECONDS = 3;
const PLAYER_NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const NOISE_SOURCE_OPTIONS = [
    { key: 'running', label: 'Running Noise' },
    { key: 'jump', label: 'Jump Noise' },
    { key: 'shooting', label: 'Shooting Noise' },
    { key: 'falling', label: 'Falling Noise' },
    { key: 'weapon_drop', label: 'Weapon Drop Noise' },
    { key: 'utility_drop', label: 'Utility Drop Noise' },
    { key: 'c4_drop', label: 'C4 Drop Noise' },
    { key: 'weapon_reload', label: 'Weapon Reload Noise' },
] as const;

const TIMELINE_UTILITY_OPTIONS = [
    { key: 'smoke', label: 'Show Smokes' },
    { key: 'flashbang', label: 'Show Flashes' },
    { key: 'hegrenade', label: 'Show HE Nades' },
    { key: 'molotov', label: 'Show Molotovs' },
    { key: 'decoy', label: 'Show Decoys' },
] as const;

const TIMELINE_COMBAT_EVENT_OPTIONS = [
    { key: 'kill', label: 'Show Kills' },
    { key: 'death', label: 'Show Deaths' },
] as const;

type MapVariant = 'default' | 'lower';
type ViewMode = '2d' | '3d';
type NoiseSourceKey = typeof NOISE_SOURCE_OPTIONS[number]['key'];
type TimelineUtilityKey = typeof TIMELINE_UTILITY_OPTIONS[number]['key'];
type TimelineCombatEventKey = typeof TIMELINE_COMBAT_EVENT_OPTIONS[number]['key'];
type ToolbarSectionKey = 'camera' | 'sight' | 'player' | 'noise' | 'timeline' | 'equipment' | 'drawing';

const TOOLBAR_SECTIONS: { key: ToolbarSectionKey; label: string }[] = [
    { key: 'camera', label: 'Camera' },
    { key: 'sight', label: 'Sight' },
    { key: 'player', label: 'Player' },
    { key: 'noise', label: 'Noise' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'drawing', label: 'Drawing' },
];

const CAMERA_MOVEMENT_CONTROLS: { direction: CameraMovementDirection; label: string }[] = [
    { direction: 'forward', label: 'Forward' },
    { direction: 'left', label: 'Left' },
    { direction: 'backward', label: 'Backward' },
    { direction: 'right', label: 'Right' },
];

const SLIDER_SHORTCUT_ACTIONS = new Set([
    'sight.width.decrease',
    'sight.width.increase',
    'sight.length.decrease',
    'sight.length.increase',
    'sight.los-width.decrease',
    'sight.los-width.increase',
    'sight.los-length.decrease',
    'sight.los-length.increase',
    'sight.los-opacity.decrease',
    'sight.los-opacity.increase',
    'camera.movement-speed.decrease',
    'camera.movement-speed.increase',
    'camera.zoom-speed.decrease',
    'camera.zoom-speed.increase',
    'player.zoom.decrease',
    'player.zoom.increase',
    'drawing.stroke.decrease',
    'drawing.stroke.increase',
    'drawing.fade.decrease',
    'drawing.fade.increase',
]);

let activeStart: number = 0;
let sightConeLength = DEFAULT_SIGHT_CONE_LENGTH;
let sightConeHalfAngle = DEFAULT_SIGHT_CONE_HALF_ANGLE;
let showSightCone = true;
let sightConeForSelectedPlayer = false;
let showLineOfSight = false;
let lineOfSightLength = DEFAULT_LINE_OF_SIGHT_LENGTH;
let lineOfSightWidth = DEFAULT_LINE_OF_SIGHT_WIDTH;
let showLineOfSight3D = true;
let lineOfSightLength3D = DEFAULT_3D_LINE_OF_SIGHT_LENGTH;
let lineOfSightWidth3D = DEFAULT_3D_LINE_OF_SIGHT_WIDTH;
let lineOfSightTransparency = 0.7;
let viewMode: ViewMode = '2d';
let replay3DScene: ReplayScene | null = null;
let localMap3D: LocalMapStatus | null = null;
let map3DLoading = false;
let map3DLoadingText = 'Loading map…';
let map3DError = '';
let viewerSettings: ViewerSettings = structuredClone(DEFAULT_VIEWER_SETTINGS);
let cameraKeyCapture: CameraMovementDirection | null = null;
let selectedPlayerZoomPercent = DEFAULT_SELECTED_PLAYER_ZOOM_PERCENT;
let mouseViewportZoomScale = 1;
let mouseViewportTranslateX = 0;
let mouseViewportTranslateY = 0;
let preserveUnconstrainedViewport = false;
let mouseViewportDrag: {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startTranslateX: number;
    startTranslateY: number;
    deselectPlayerOnMove: boolean;
    hasMoved: boolean;
} | null = null;
let ignoreNextCanvasClick = false;
let leftDrawingColor = TEAM_CT_COLOR;
let rightDrawingColor = TEAM_T_COLOR;
let drawingStrokeWidth = DEFAULT_DRAWING_STROKE_WIDTH;
let drawingMode: 'permanent' | 'fade' = 'permanent';
let drawingFadeSeconds = DEFAULT_DRAWING_FADE_SECONDS;
let isDrawingShortcutActive = false;
let drawingShortcutHeldCodes = new Set<string>();
let drawingClearSignal = 0;
let showDroppedWeapons = true;
let showDroppedUtility = true;
let showDroppedC4 = true;
let selectedPlayerSteamId: bigint | null = null;
let showNoiseCircle = false;
let noiseForSelectedPlayer = false;
let enabledNoiseSources: Record<NoiseSourceKey, boolean> = {
    running: true,
    jump: true,
    shooting: true,
    falling: true,
    weapon_drop: true,
    utility_drop: true,
    c4_drop: true,
    weapon_reload: true,
};
let showAllTimelineUtilities = false;
let enabledTimelineUtilities: Record<TimelineUtilityKey, boolean> = {
    smoke: true,
    flashbang: true,
    hegrenade: true,
    molotov: true,
    decoy: true,
};
let enabledTimelineCombatEvents: Record<TimelineCombatEventKey, boolean> = {
    kill: true,
    death: true,
};
let mapVariant: MapVariant = 'default';
let hasLowerMapVariant = false;
let playablePlayers: PlayerInfo[] = [];
let ctRoster: RosterEntry[] = [];
let tRoster: RosterEntry[] = [];
let ctAliveCount = 0;
let tAliveCount = 0;
let timelineEvents: PlayerTimelineEvent[] = [];
let timelineEventsKey = '';
let timelineEventsCache = new Map<string, { events: PlayerTimelineEvent[]; height: number }>();
let timelineHeight = TIMELINE_MIN_HEIGHT;
let matchScore: MatchScore | null = null;
let toastMessage = '';
let toastTimeout: ReturnType<typeof setTimeout> | null = null;
let activeToolbarSection: ToolbarSectionKey | null = null;
let visibleToolbarSections = TOOLBAR_SECTIONS.filter(section => section.key !== 'camera');
let shortcutBindings: Record<string, string> = {};
let shortcutCaptureActionId: string | null = null;
let pendingCaptureKeyboardShortcut: { code: string; shortcut: string } | null = null;
const heldShortcutCodes = new Set<string>();
let bombStatus: BombStatus = { bombText: '', bombClass: '', defuseText: '', defuseClass: '' };
let playerFrameTrails = new Map<string, PlayerFrame[]>();
let playerFrameLookupIndices = new Map<string, number>();
let timelineNadesByThrower = new Map<string, NadeEvent[]>();
let timelineTrajectoryNadesByThrower = new Map<string, NadeEvent[]>();
let timelineTrajectoryNades: NadeEvent[] = [];
let timelineNadeMatchCache = new WeakMap<NadeEvent, boolean>();
let nadeClickTimeout: ReturnType<typeof setTimeout> | null = null;
let deadIconClickTimeout: ReturnType<typeof setTimeout> | null = null;
let nadeLayer: {
    getNadeInteractionAtCanvasPoint: (
        x: number,
        y: number,
        tick: number
    ) => { throwTick: number; throwerSteamId: bigint } | null;
} | null = null;

type RosterEntry = {
    player: PlayerInfo;
    side: number;
    isAlive: boolean;
    color: string;
};

type PlayerEventType = 'kill' | 'death' | 'smoke' | 'flashbang' | 'molotov' | 'hegrenade' | 'decoy' | 'bomb_planted' | 'bomb_exploded' | 'bomb_defused' | 'round_time_expired';

type BasePlayerTimelineEvent = {
    tick: number;
    type: PlayerEventType;
    label: string;
    color: string;
    iconPath?: string;
    title: string;
    playerSteamId?: bigint;
};

type PlayerTimelineEvent = BasePlayerTimelineEvent & {
    id: string;
    lane: number;
    leftPct: number;
};

type BombStatus = {
    bombText: string;
    bombClass: string;
    defuseText: string;
    defuseClass: string;
};

type MatchScoreSegment = {
    name: string;
    score: number;
    side: number;
};

type MatchScore = {
    left: MatchScoreSegment;
    right: MatchScoreSegment;
};

type ViewportTransform = {
    scale: number;
    translateX: number;
    translateY: number;
};

function resetLoadedReplayState(clearReplayData = false): void {
    setPlaying(false);
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }

    if (clearReplayData) {
        replayData = null;
        isMapReady = false;
        mapMetadata = createMapMetadataFromRadarInfo();
    }

    selectedPlayerSteamId = null;
    isDrawingShortcutActive = false;
    drawingShortcutHeldCodes.clear();
    mapVariant = 'default';
    hasLowerMapVariant = false;
    playablePlayers = [];
    ctRoster = [];
    tRoster = [];
    ctAliveCount = 0;
    tAliveCount = 0;
    timelineEvents = [];
    timelineEventsKey = '';
    timelineHeight = TIMELINE_MIN_HEIGHT;
    matchScore = null;
    bombStatus = emptyBombStatus();
    activeStart = 0;
    roundProgressPct = 0;
    playerFrameTrails.clear();
    playerFrameLookupIndices.clear();
    timelineNadesByThrower.clear();
    timelineTrajectoryNadesByThrower.clear();
    timelineTrajectoryNades = [];
    timelineNadeMatchCache = new WeakMap<NadeEvent, boolean>();
    timelineEventsCache.clear();
    resetMouseViewportZoom();
    resetReplayViewportTransform();
    setTick(0);
}

function applyLoadedReplay(data: ReplayData): void {
    isMapReady = false;
    replayData = data;
    mapMetadata = fillMapMetadata(data.map, data.header?.mapName);
    selectedPlayerSteamId = null;
    timelineEventsCache.clear();
    playablePlayers = getPlayablePlayers();
    rebuildPlayerFrameIndex(playablePlayers);
    rebuildTimelineNadeIndex();
    warmTimelineEventsCache();
    isDrawingShortcutActive = false;
    drawingShortcutHeldCodes.clear();
    mapVariant = 'default';
    timelineEvents = [];
    timelineEventsKey = '';
    timelineHeight = TIMELINE_MIN_HEIGHT;
    matchScore = null;
    bombStatus = emptyBombStatus();
    setPlaying(false);
    setTick(data.rounds[0] ? getRoundActiveStart(data.rounds[0]) : 0);
    replay3DScene?.setReplay(data);
    if (viewMode === '3d') void prepareCurrent3DMap();
}

function apply3DSceneSettings(): void {
    replay3DScene?.setSightSettings(showLineOfSight3D, lineOfSightLength3D, lineOfSightWidth3D, 1 - lineOfSightTransparency);
    replay3DScene?.setCameraControls(
        viewerSettings.cameraMovementKeys,
        viewerSettings.cameraMovementSpeed,
        viewerSettings.cameraZoomSpeed
    );
    replay3DScene?.setCamera(selectedPlayerSteamId === null ? 'free' : 'player', selectedPlayerSteamId);
}

function mount3DScene(canvas: HTMLCanvasElement): { destroy: () => void } {
    const scene = new ReplayScene(canvas);
    replay3DScene = scene;
    scene.setPlayerSelectHandler(selectPlayer);
    if (replayData) scene.setReplay(replayData);
    scene.setTick(getPlaybackTick());
    apply3DSceneSettings();
    return {
        destroy: () => {
            if (replay3DScene === scene) replay3DScene = null;
            scene.dispose();
        }
    };
}

async function chooseCs2GamePath(): Promise<string | null> {
    let savedPath = viewerSettings.cs2GamePath;
    if (savedPath) {
        try {
            savedPath = await validateCs2Folder(savedPath);
        } catch {
            savedPath = '';
        }
    }
    if (!savedPath) {
        showToast('Select the steamapps\\common\\Counter-Strike Global Offensive folder');
        const selected = await open({
            directory: true,
            multiple: false,
            title: 'Select steamapps\\common\\Counter-Strike Global Offensive'
        });
        if (typeof selected !== 'string') return null;
        savedPath = await validateCs2Folder(selected);
    }
    viewerSettings = { ...viewerSettings, cs2GamePath: savedPath };
    await saveViewerSettings(viewerSettings);
    return savedPath;
}

async function setViewMode(mode: ViewMode): Promise<void> {
    if (mode === viewMode) return;
    if (mode === '2d') {
        viewMode = '2d';
        if (activeToolbarSection === 'camera') activeToolbarSection = null;
        return;
    }
    map3DError = '';
    try {
        if (!await chooseCs2GamePath()) return;
        viewMode = '3d';
        await flushDom();
        await prepareCurrent3DMap();
    } catch (cause) {
        map3DError = cause instanceof Error ? cause.message : String(cause);
        showToast(map3DError);
    }
}

async function prepareCurrent3DMap(): Promise<void> {
    const mapName = replayData?.header?.mapName;
    const gamePath = viewerSettings.cs2GamePath;
    if (!mapName || !gamePath || !replay3DScene || map3DLoading) return;
    map3DLoading = true;
    map3DLoadingText = `Checking the ${mapName} cache…`;
    map3DError = '';
    try {
        localMap3D = await getMapStatus(mapName, gamePath);
        if (!localMap3D.vpkPath) throw new Error(`The installed ${mapName} map data was not found`);
        if (!localMap3D.ready) {
            if (!localMap3D.extractorAvailable) {
                throw new Error('The 3D map component is missing from this installation. Reinstall CS2 Replay Viewer.');
            }
            map3DLoadingText = `Creating the local ${mapName} 3D cache…`;
            localMap3D = await prepareMap(mapName, gamePath);
        }
        map3DLoadingText = `Loading cached ${mapName} map…`;
        await load3DMapScene(localMap3D);
    } catch (cause) {
        map3DError = cause instanceof Error ? cause.message : String(cause);
    } finally {
        map3DLoading = false;
    }
}

async function load3DMapScene(status: LocalMapStatus): Promise<void> {
    if (!status.scenePath || !replay3DScene || !viewerSettings.cs2GamePath) return;
    const url = await mapSceneUrl(status, viewerSettings.cs2GamePath);
    await replay3DScene.loadMap(url);
}

function beginCameraKeyCapture(direction: CameraMovementDirection): void {
    cameraKeyCapture = direction;
}

function captureCameraKey(event: KeyboardEvent, direction: CameraMovementDirection): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.code === 'Escape') {
        cameraKeyCapture = null;
        return;
    }
    viewerSettings = {
        ...viewerSettings,
        cameraMovementKeys: { ...viewerSettings.cameraMovementKeys, [direction]: event.code }
    };
    cameraKeyCapture = null;
    apply3DSceneSettings();
    void saveViewerSettings(viewerSettings);
}

function updateCameraSetting(key: 'cameraMovementSpeed' | 'cameraZoomSpeed', value: number): void {
    viewerSettings = { ...viewerSettings, [key]: value };
    apply3DSceneSettings();
    void saveViewerSettings(viewerSettings);
}

async function loadDemo() {
    if (!browser) return;
    isLoading = true;
    try {
        const demPath: string | null = await invoke('open_file_dialog');
        if (!demPath) return;

        resetLoadedReplayState(true);
        await flushDom();

        const pbPath: string = await invoke('parse_demo', { path: demPath });
        const bytes = await readFile(pbPath);
        void invoke('release_replay_file', { path: pbPath }).catch(() => undefined);
        const data = fromBinary(ReplayDataSchema, bytes);
        applyLoadedReplay(data);
    } catch (e: any) {
        console.error('Failed to load demo:', e);
    } finally {
        isLoading = false;
    }
}

function getCurrentRoundData(tick: number = Math.floor(getPlaybackTick())): RoundData | null {
    return getReplayRoundForTick(replayData, tick);
}

function getPlaybackStartRound(tick: number = Math.floor(getPlaybackTick())): RoundData | null {
    return getReplayPlaybackStartRound(replayData, tick);
}

function getRoundActiveStart(round: RoundData): number {
    if (round.freezetimeEndTick > 0) return round.freezetimeEndTick;
    const estimatedFreezetimeTicks = 960;
    return round.startTick + estimatedFreezetimeTicks;
}

function getRoundForTick(tick: number): RoundData | null {
    return getReplayRoundForTick(replayData, tick);
}

function getPlayablePlayers(): PlayerInfo[] {
    if (!replayData?.players) return [];
    return replayData.players.filter(player => player.team === TEAM_T || player.team === TEAM_CT);
}

function rebuildPlayerFrameIndex(players: PlayerInfo[]): void {
    playerFrameTrails.clear();
    playerFrameLookupIndices.clear();
    if (!replayData?.frames || players.length === 0) return;

    const playableSteamIds = new Set(players.map(player => player.steamId.toString()));
    for (const frame of replayData.frames) {
        const steamId = frame.steamId.toString();
        if (!playableSteamIds.has(steamId)) continue;
        if (!playerFrameTrails.has(steamId)) {
            playerFrameTrails.set(steamId, []);
        }
        playerFrameTrails.get(steamId)?.push(frame);
    }
}

function getPlayerTeamForRound(player: PlayerInfo, round: RoundData | null): number {
    if (player.team !== TEAM_T && player.team !== TEAM_CT) return 0;
    if (!round) return player.team;

    const halfSize = round.roundNumber <= 24 ? 12 : 3;
    const halfIndex = Math.floor((round.roundNumber - 1) / halfSize);
    const shouldFlipStoredSide = halfIndex % 2 === 0;

    if (shouldFlipStoredSide) {
        if (player.team === TEAM_T) return TEAM_CT;
        if (player.team === TEAM_CT) return TEAM_T;
    }

    return player.team;
}

function getOppositeSide(side: number): number {
    if (side === TEAM_T) return TEAM_CT;
    if (side === TEAM_CT) return TEAM_T;
    return 0;
}

function getSideForInitialSide(initialSide: number, round: RoundData): number {
    if (initialSide !== TEAM_T && initialSide !== TEAM_CT) return 0;

    const halfSize = round.roundNumber <= 24 ? 12 : 3;
    const halfIndex = Math.floor((round.roundNumber - 1) / halfSize);
    return halfIndex % 2 === 0 ? initialSide : getOppositeSide(initialSide);
}

function getRepresentativeNameForInitialSide(firstRound: RoundData, initialSide: number): string {
    const player = playablePlayers.find(candidate =>
        getPlayerTeamForRound(candidate, firstRound) === initialSide
    );
    return player?.name || (initialSide === TEAM_T ? 'T' : 'CT');
}

function getRoundScoreTick(round: RoundData): number {
    const terminalTick = getRoundTerminalTick(replayData, round);
    if (terminalTick !== null) return terminalTick;

    const delayedEndFallback = round.endTick - getRoundEndDelayTicks(replayData);
    return Math.max(round.startTick, delayedEndFallback);
}

function buildMatchScore(tick: number, currentRound: RoundData | null): MatchScore | null {
    const rounds = replayData?.rounds ?? [];
    if (rounds.length === 0 || playablePlayers.length === 0) return null;

    const firstRound = rounds[0];
    const sideRound = currentRound ?? firstRound;
    const initialTName = getRepresentativeNameForInitialSide(firstRound, TEAM_T);
    const initialCTName = getRepresentativeNameForInitialSide(firstRound, TEAM_CT);
    let initialTScore = 0;
    let initialCTScore = 0;

    for (const round of rounds) {
        if (round.winnerTeam !== TEAM_T && round.winnerTeam !== TEAM_CT) continue;
        if (tick < getRoundScoreTick(round)) continue;

        if (round.winnerTeam === getSideForInitialSide(TEAM_T, round)) {
            initialTScore++;
        } else if (round.winnerTeam === getSideForInitialSide(TEAM_CT, round)) {
            initialCTScore++;
        }
    }

    return {
        left: {
            name: initialTName,
            score: initialTScore,
            side: getSideForInitialSide(TEAM_T, sideRound),
        },
        right: {
            name: initialCTName,
            score: initialCTScore,
            side: getSideForInitialSide(TEAM_CT, sideRound),
        },
    };
}

function getMatchScoreSideClass(side: number): string {
    if (side === TEAM_CT) return 'side-ct';
    if (side === TEAM_T) return 'side-t';
    return 'side-neutral';
}

function getTeamColor(team: number): string {
    if (team === TEAM_T) return TEAM_T_COLOR;
    if (team === TEAM_CT) return TEAM_CT_COLOR;
    return '#e2e8f0';
}

function getPlayerFrameAtTick(steamId: bigint, tick: number): PlayerFrame | null {
    const key = steamId.toString();
    const trail = playerFrameTrails.get(key);
    if (!trail || trail.length === 0) return null;

    let idx = playerFrameLookupIndices.get(key) ?? 0;
    if (idx >= trail.length || trail[idx].tick > tick) {
        let lo = 0;
        let hi = trail.length - 1;
        let best = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (trail[mid].tick <= tick) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        idx = best;
    } else {
        while (idx < trail.length - 1 && trail[idx + 1].tick <= tick) {
            idx++;
        }
    }

    playerFrameLookupIndices.set(key, idx);
    return trail[idx] ?? null;
}

function buildRosterEntries(round: RoundData | null, tick: number): RosterEntry[] {
    return playablePlayers
        .map(player => {
            const side = getPlayerTeamForRound(player, round);
            const frame = getPlayerFrameAtTick(player.steamId, tick);
            const isAlive = frame?.isAlive ?? false;
            return {
                player,
                side,
                isAlive,
                color: isAlive ? getTeamColor(side) : DEAD_PLAYER_COLOR,
            };
        })
        .filter(entry => entry.side === TEAM_CT || entry.side === TEAM_T);
}

function compareRosterEntriesByPlayerName(a: RosterEntry, b: RosterEntry): number {
    const nameOrder = PLAYER_NAME_COLLATOR.compare(a.player.name, b.player.name);
    if (nameOrder !== 0) return nameOrder;
    if (a.player.steamId === b.player.steamId) return 0;
    return a.player.steamId < b.player.steamId ? -1 : 1;
}

function getPlayerName(steamId: bigint): string {
    const player = replayData?.players?.find(p => p.steamId === steamId);
    return player?.name || 'BOT';
}

function getNadeMeta(nadeType: string): Omit<BasePlayerTimelineEvent, 'tick' | 'title'> | null {
    if (nadeType === 'smoke') {
        return { type: 'smoke', label: '', color: '#9ca3af', iconPath: equipmentIconPath(TIMELINE_ICON_FILES.smoke) };
    }
    if (nadeType === 'flashbang') {
        return { type: 'flashbang', label: '', color: '#fde047', iconPath: equipmentIconPath(TIMELINE_ICON_FILES.flashbang) };
    }
    if (nadeType === 'molotov') {
        return { type: 'molotov', label: '', color: '#dc2626', iconPath: equipmentIconPath(TIMELINE_ICON_FILES.molotov) };
    }
    if (nadeType === 'incendiary') {
        return { type: 'molotov', label: '', color: '#dc2626', iconPath: equipmentIconPath(TIMELINE_ICON_FILES.incendiary) };
    }
    if (nadeType === 'hegrenade') {
        return { type: 'hegrenade', label: '', color: '#f97316', iconPath: equipmentIconPath(TIMELINE_ICON_FILES.hegrenade) };
    }
    if (nadeType === 'decoy') {
        return { type: 'decoy', label: '', color: '#92400e', iconPath: equipmentIconPath(TIMELINE_ICON_FILES.decoy) };
    }
    return null;
}

function getNadeTypeName(nadeType: string): string {
    if (nadeType === 'smoke') return 'Smoke';
    if (nadeType === 'flashbang') return 'Flashbang';
    if (nadeType === 'molotov') return 'Molotov';
    if (nadeType === 'incendiary') return 'Incendiary Grenade';
    if (nadeType === 'hegrenade') return 'HE Grenade';
    if (nadeType === 'decoy') return 'Decoy';
    return 'Nade';
}

function getNadeThrowTick(nade: NadeEvent): number {
    const firstTrajectoryTick = nade.trajectory?.find(point => point.tick > 0)?.tick ?? 0;
    if (firstTrajectoryTick > 0) return firstTrajectoryTick;
    return nade.tick || nade.detonationTick;
}

function getNadeDetonationTick(nade: NadeEvent): number {
    return nade.detonationTick || nade.tick;
}

function isTimelineProjectileRecord(nade: NadeEvent): boolean {
    return (nade.trajectory?.length ?? 0) > 0 || nade.startX !== 0 || nade.startY !== 0 || nade.startZ !== 0;
}

async function openDonationPage(): Promise<void> {
    try {
        await invoke('plugin:shell|open', { path: DONATION_URL });
    } catch (error) {
        console.error('Failed to open donation page:', error);
    }
}

function getNadeTrajectoryEndPoint(nade: NadeEvent): { x: number; y: number } | null {
    const trajectory = nade.trajectory ?? [];
    for (let i = trajectory.length - 1; i >= 0; i--) {
        const point = trajectory[i];
        if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
            return { x: point.x, y: point.y };
        }
    }
    return null;
}

function areMatchingNadeTypes(a: string, b: string): boolean {
    if (a === b) return true;
    const aIsFire = a === 'molotov' || a === 'incendiary';
    const bIsFire = b === 'molotov' || b === 'incendiary';
    return aIsFire && bIsFire;
}

function getNadeMatchTickWindow(nadeType: string): number {
    return nadeType === 'smoke' || nadeType === 'decoy' ? SMOKE_MATCH_TICK_WINDOW : NADE_MATCH_TICK_WINDOW;
}

function hasMatchingTrajectoryNade(eventOnlyNade: NadeEvent, steamId: bigint): boolean {
    if (!replayData?.nades) return false;
    const cachedMatch = timelineNadeMatchCache.get(eventOnlyNade);
    if (cachedMatch !== undefined) return cachedMatch;

    const eventTick = getNadeDetonationTick(eventOnlyNade);
    const eventEnd = { x: eventOnlyNade.endX, y: eventOnlyNade.endY };
    const candidates = steamId === 0n
        ? timelineTrajectoryNades
        : (timelineTrajectoryNadesByThrower.get(steamId.toString()) ?? []);

    const hasMatch = candidates.some(candidate => {
        if (candidate === eventOnlyNade) return false;
        if (!areMatchingNadeTypes(candidate.nadeType, eventOnlyNade.nadeType)) return false;
        if (Math.abs(getNadeDetonationTick(candidate) - eventTick) > getNadeMatchTickWindow(eventOnlyNade.nadeType)) {
            return false;
        }

        const candidateEnd = getNadeTrajectoryEndPoint(candidate) ?? { x: candidate.endX, y: candidate.endY };
        const dx = candidateEnd.x - eventEnd.x;
        const dy = candidateEnd.y - eventEnd.y;
        return dx * dx + dy * dy <= NADE_MATCH_DISTANCE_UNITS * NADE_MATCH_DISTANCE_UNITS;
    });
    timelineNadeMatchCache.set(eventOnlyNade, hasMatch);
    return hasMatch;
}

function shouldShowNadeThrowMarker(nade: NadeEvent, steamId: bigint): boolean {
    if (isTimelineProjectileRecord(nade)) return true;
    return !hasMatchingTrajectoryNade(nade, steamId);
}

function isTimelineUtilityType(type: PlayerEventType): type is TimelineUtilityKey {
    return type === 'smoke' || type === 'flashbang' || type === 'hegrenade' || type === 'molotov' || type === 'decoy';
}

function isTimelineUtilityEnabled(type: PlayerEventType): boolean {
    return isTimelineUtilityType(type) && (enabledTimelineUtilities[type] ?? false);
}

function formatRoundEventTime(tick: number, round: RoundData): string {
    const seconds = Math.max(0, Math.floor((tick - getRoundActiveStart(round)) / 64));
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    return `${remainingSeconds}s`;
}

function stackTimelineEvents(events: BasePlayerTimelineEvent[], round: RoundData): PlayerTimelineEvent[] {
    const activeStart = getRoundActiveStart(round);
    const duration = Math.max(1, getRoundDisplayEndTick(replayData, round) - activeStart);
    const trackWidth = browser ? Math.max(1, window.innerWidth - TIMELINE_HORIZONTAL_PADDING) : 1024;
    const minimumCenterDistance = TIMELINE_MARKER_ICON_SIZE + TIMELINE_MARKER_HORIZONTAL_GAP;
    const laneLastCenterPositions: number[] = [];

    return [...events]
        .sort((a, b) => a.tick - b.tick)
        .map((event, index) => {
            const leftPct = Math.max(0, Math.min(100, ((event.tick - activeStart) / duration) * 100));
            const centerPosition = (leftPct / 100) * trackWidth;
            let lane = laneLastCenterPositions.findIndex(
                lastCenterPosition => centerPosition - lastCenterPosition >= minimumCenterDistance
            );
            if (lane === -1) {
                lane = laneLastCenterPositions.length;
            }
            laneLastCenterPositions[lane] = centerPosition;
            return {
                ...event,
                id: `${event.type}-${event.tick}-${index}`,
                lane,
                leftPct,
            };
        });
}

function rebuildTimelineNadeIndex(): void {
    timelineNadesByThrower.clear();
    timelineTrajectoryNadesByThrower.clear();
    timelineTrajectoryNades = [];
    timelineNadeMatchCache = new WeakMap<NadeEvent, boolean>();

    const nades = replayData?.nades ?? [];
    for (const nade of nades) {
        if (!isTimelineProjectileRecord(nade)) continue;
        const throwerKey = nade.throwerSteamId.toString();
        timelineTrajectoryNades.push(nade);
        const trajectoryNades = timelineTrajectoryNadesByThrower.get(throwerKey) ?? [];
        trajectoryNades.push(nade);
        timelineTrajectoryNadesByThrower.set(throwerKey, trajectoryNades);
    }

    for (const nade of nades) {
        if (!shouldShowNadeThrowMarker(nade, nade.throwerSteamId)) continue;
        const throwerKey = nade.throwerSteamId.toString();
        const throwerNades = timelineNadesByThrower.get(throwerKey) ?? [];
        throwerNades.push(nade);
        timelineNadesByThrower.set(throwerKey, throwerNades);
    }
}

function getTimelineHeight(events: PlayerTimelineEvent[]): number {
    const laneCount = events.reduce((highestLane, event) => Math.max(highestLane, event.lane + 1), 0);
    if (laneCount === 0) return TIMELINE_MIN_HEIGHT;

    const markerTrackHeight =
        laneCount * TIMELINE_MARKER_BUTTON_SIZE +
        Math.max(0, laneCount - 1) * TIMELINE_MARKER_LANE_GAP +
        TIMELINE_MARKER_BOTTOM_PADDING;
    return Math.max(TIMELINE_MIN_HEIGHT, TIMELINE_FIXED_CONTENT_HEIGHT + markerTrackHeight);
}

function buildNadeTimelineEvent(nade: NadeEvent, round: RoundData): BasePlayerTimelineEvent | null {
    const meta = getNadeMeta(nade.nadeType);
    if (!meta || !isTimelineUtilityEnabled(meta.type)) {
        return null;
    }

    const throwTick = getNadeThrowTick(nade);
    if (throwTick < round.startTick || throwTick > getRoundDisplayEndTick(replayData, round)) return null;

    const playerName = nade.throwerSteamId !== 0n ? `${getPlayerName(nade.throwerSteamId)} threw ` : 'Threw ';
    const thrower = replayData?.players?.find(player => player.steamId === nade.throwerSteamId);
    const color = thrower ? getTeamColor(getPlayerTeamForRound(thrower, round)) : meta.color;
    return {
        tick: throwTick,
        type: meta.type,
        label: meta.label,
        color,
        iconPath: meta.iconPath,
        title: `${playerName}${getNadeTypeName(nade.nadeType)} at ${formatRoundEventTime(throwTick, round)}`,
        playerSteamId: nade.throwerSteamId || undefined,
    };
}

function buildKillDeathTimelineEvents(round: RoundData, steamId: bigint | null = null): BasePlayerTimelineEvent[] {
    if (!replayData) return [];

    const events: BasePlayerTimelineEvent[] = [];
    const roundKills = replayData.kills?.filter(kill =>
        kill.tick >= round.startTick && kill.tick <= getRoundDisplayEndTick(replayData, round)
    ) ?? [];

    for (const kill of roundKills) {
        if (enabledTimelineCombatEvents.kill && (steamId === null || kill.killerSteamId === steamId)) {
            const killer = replayData.players?.find(player => player.steamId === kill.killerSteamId);
            events.push({
                tick: kill.tick,
                type: 'kill',
                label: '',
                color: killer ? getTeamColor(getPlayerTeamForRound(killer, round)) : '#e2e8f0',
                iconPath: equipmentIconPath(TIMELINE_ICON_FILES.kill),
                title: `${getPlayerName(kill.killerSteamId)} killed ${getPlayerName(kill.victimSteamId)} with ${kill.weapon} at ${formatRoundEventTime(kill.tick, round)}`,
                playerSteamId: kill.killerSteamId || undefined,
            });
        }
        if (enabledTimelineCombatEvents.death && (steamId === null || kill.victimSteamId === steamId)) {
            const victim = replayData.players?.find(player => player.steamId === kill.victimSteamId);
            events.push({
                tick: kill.tick,
                type: 'death',
                label: '',
                color: victim ? getTeamColor(getPlayerTeamForRound(victim, round)) : '#e2e8f0',
                iconPath: equipmentIconPath(
                    kill.isHeadshot ? TIMELINE_ICON_FILES.headshotDeath : TIMELINE_ICON_FILES.death
                ),
                title: `${getPlayerName(kill.victimSteamId)} died to ${getPlayerName(kill.killerSteamId)} at ${formatRoundEventTime(kill.tick, round)}`,
                playerSteamId: kill.victimSteamId || undefined,
            });
        }
    }

    return events;
}

function buildSelectedPlayerBaseEvents(steamId: bigint, round: RoundData, includeUtilities = true): BasePlayerTimelineEvent[] {
    if (!replayData) return [];

    const events: BasePlayerTimelineEvent[] = buildKillDeathTimelineEvents(round, steamId);

    if (includeUtilities) {
        for (const nade of timelineNadesByThrower.get(steamId.toString()) ?? []) {
            const event = buildNadeTimelineEvent(nade, round);
            if (event) events.push(event);
        }
    }

    return events;
}

function buildAllUtilityRoundEvents(round: RoundData): BasePlayerTimelineEvent[] {
    if (!replayData) return [];

    const events: BasePlayerTimelineEvent[] = [];
    for (const playerNades of timelineNadesByThrower.values()) {
        for (const nade of playerNades) {
            const event = buildNadeTimelineEvent(nade, round);
            if (event) events.push(event);
        }
    }
    return events;
}

function getBombEventsForRound(round: RoundData): BombEvent[] {
    const displayEndTick = getRoundDisplayEndTick(replayData, round);
    return [...(replayData?.bombs ?? [])]
        .filter(event => event.tick >= round.startTick && event.tick <= displayEndTick)
        .sort((a, b) => a.tick - b.tick);
}

function getBombEventForRound(round: RoundData, eventType: string): BombEvent | null {
    return getBombEventsForRound(round).find(event => event.eventType === eventType) ?? null;
}

function buildBombRoundEvents(round: RoundData): BasePlayerTimelineEvent[] {
    const events: BasePlayerTimelineEvent[] = [];
    const bombEvents = getBombEventsForRound(round);
    const plantBegin = bombEvents.find(event => event.eventType === 'plant_begin') ?? null;
    const planted = bombEvents.find(event => event.eventType === 'planted') ?? null;
    const exploded = bombEvents.find(event => event.eventType === 'exploded') ?? null;
    const defused = bombEvents.find(event => event.eventType === 'defused') ?? null;
    const fallbackPlantTick = getFallbackBombPlantTick(round, bombEvents);

    if (planted || fallbackPlantTick > 0) {
        const plantTick = planted?.tick ?? fallbackPlantTick;
        const siteName = planted?.site || plantBegin?.site || '';
        const site = siteName ? ` ${siteName}` : '';
        events.push({
            tick: plantTick,
            type: 'bomb_planted',
            label: '',
            color: TEAM_T_COLOR,
            iconPath: equipmentIconPath(TIMELINE_ICON_FILES.bombPlanted),
            title: `Bomb planted${site} at ${formatRoundEventTime(plantTick, round)}`,
            playerSteamId: planted?.playerSteamId || plantBegin?.playerSteamId || undefined,
        });
    }

    if (exploded || round.winReason === 'bomb_detonated') {
        const tick = exploded?.tick ?? round.endTick;
        events.push({
            tick,
            type: 'bomb_exploded',
            label: '',
            color: TEAM_T_COLOR,
            iconPath: equipmentIconPath(TIMELINE_ICON_FILES.bombExploded),
            title: `Bomb exploded at ${formatRoundEventTime(tick, round)}`,
        });
    }

    if (defused || round.winReason === 'bomb_defused') {
        const tick = defused?.tick ?? round.endTick;
        events.push({
            tick,
            type: 'bomb_defused',
            label: '',
            color: TEAM_CT_COLOR,
            iconPath: equipmentIconPath(TIMELINE_ICON_FILES.bombDefused),
            title: `Bomb defused at ${formatRoundEventTime(tick, round)}`,
            playerSteamId: defused?.playerSteamId || undefined,
        });
    }

    return events;
}

function buildRoundOutcomeEvents(round: RoundData): BasePlayerTimelineEvent[] {
    if (round.winReason !== 'target_saved' && round.winReason !== 'time_ran_out') return [];

    const tick = getRoundScoreTick(round);
    const winnerName = round.winnerTeam === TEAM_T
        ? 'Terrorists'
        : round.winnerTeam === TEAM_CT
            ? 'Counter-Terrorists'
            : 'Team';

    return [{
        tick,
        type: 'round_time_expired',
        label: '',
        color: getTeamColor(round.winnerTeam),
        iconPath: equipmentIconPath(TIMELINE_ICON_FILES.timeExpired),
        title: `${winnerName} won when time expired at ${formatRoundEventTime(tick, round)}`,
    }];
}

function buildTimelineEvents(selectedSteamId: bigint | null, round: RoundData): PlayerTimelineEvent[] {
    const events = buildBombRoundEvents(round);
    events.push(...buildRoundOutcomeEvents(round));
    if (showAllTimelineUtilities) {
        events.push(...buildKillDeathTimelineEvents(round));
        events.push(...buildAllUtilityRoundEvents(round));
    } else if (selectedSteamId !== null) {
        events.push(...buildSelectedPlayerBaseEvents(selectedSteamId, round));
    }
    return stackTimelineEvents(events, round);
}

function getTimelineEventsKey(round: RoundData | null, selectedSteamId: bigint | null): string {
    if (!round) return 'no-round';
    const utilityFilterKey = TIMELINE_UTILITY_OPTIONS
        .map(option => `${option.key}:${enabledTimelineUtilities[option.key] ? 1 : 0}`)
        .join(',');
    const combatFilterKey = TIMELINE_COMBAT_EVENT_OPTIONS
        .map(option => `${option.key}:${enabledTimelineCombatEvents[option.key] ? 1 : 0}`)
        .join(',');
    const layoutWidth = browser ? window.innerWidth : 1024;
    const selectionKey = showAllTimelineUtilities ? 'all' : (selectedSteamId?.toString() ?? 'none');
    return `${round.roundNumber}:${round.startTick}:${getRoundDisplayEndTick(replayData, round)}:${selectionKey}:${showAllTimelineUtilities ? 'all-utils' : 'selected'}:${utilityFilterKey}:${combatFilterKey}:${layoutWidth}`;
}

function updateTimelineEvents(round: RoundData | null): void {
    const nextKey = getTimelineEventsKey(round, selectedPlayerSteamId);
    if (nextKey === timelineEventsKey) return;

    timelineEventsKey = nextKey;
    const cached = timelineEventsCache.get(nextKey);
    if (cached) {
        timelineEvents = cached.events;
        timelineHeight = cached.height;
        return;
    }

    const events = round ? buildTimelineEvents(selectedPlayerSteamId, round) : [];
    const height = getTimelineHeight(events);
    timelineEventsCache.set(nextKey, { events, height });
    timelineEvents = events;
    timelineHeight = height;
}

function warmTimelineEventsCache(): void {
    if (!replayData) return;

    const selectedPlayers = showAllTimelineUtilities
        ? [null]
        : playablePlayers.map(player => player.steamId);
    for (const round of replayData.rounds ?? []) {
        for (const selectedSteamId of selectedPlayers) {
            const key = getTimelineEventsKey(round, selectedSteamId);
            if (timelineEventsCache.has(key)) continue;
            const events = buildTimelineEvents(selectedSteamId, round);
            timelineEventsCache.set(key, {
                events,
                height: getTimelineHeight(events),
            });
        }
    }
}

function emptyBombStatus(): BombStatus {
    return { bombText: '', bombClass: '', defuseText: '', defuseClass: '' };
}

function getBombTimeSeconds(): number {
    return replayData?.header?.bombTimeSeconds || DEFAULT_BOMB_TIME_SECONDS;
}

function getBombTimeTicks(): number {
    return Math.round(getBombTimeSeconds() * getTickRate());
}

function getBombCountdownEndTick(plantTick: number, round: RoundData): number {
    const exploded = getBombEventForRound(round, 'exploded');
    if (exploded && exploded.tick >= plantTick) return exploded.tick;
    return plantTick + getBombTimeTicks();
}

function getPlantEndTick(plantBegin: BombEvent, events: BombEvent[]): number {
    const completedPlant = getFirstBombEventAfter(events, 'planted', plantBegin.tick);
    if (completedPlant) return completedPlant.tick;
    return plantBegin.tick + Math.round(DEFAULT_PLANT_SECONDS * getTickRate());
}

function getLastBombEventBefore(events: BombEvent[], eventType: string, tick: number): BombEvent | null {
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event.tick <= tick && event.eventType === eventType) return event;
    }
    return null;
}

function getFirstBombEventAfter(events: BombEvent[], eventType: string, tick: number): BombEvent | null {
    return events.find(event => event.tick >= tick && event.eventType === eventType) ?? null;
}

function getFallbackBombPlantTick(round: RoundData, events: BombEvent[]): number {
    const plantBegin = events.find(event => event.eventType === 'plant_begin') ?? null;
    const planted = events.find(event => event.eventType === 'planted') ?? null;
    if (planted) return planted.tick;

    const exploded = events.find(event => event.eventType === 'exploded') ?? null;
    const defused = events.find(event => event.eventType === 'defused') ?? null;
    const hasBombObjectiveResult = Boolean(
        exploded ||
        defused ||
        round.winReason === 'bomb_detonated' ||
        round.winReason === 'bomb_defused'
    );
    if (!hasBombObjectiveResult) return 0;

    if (plantBegin) return getPlantEndTick(plantBegin, events);

    const objectiveEndTick = exploded?.tick ?? defused?.tick ?? round.endTick;
    const activeStart = getRoundActiveStart(round);
    return Math.max(activeStart, objectiveEndTick - getBombTimeTicks());
}

function hasBombEventBetween(events: BombEvent[], eventTypes: string[], startTick: number, endTick: number): boolean {
    return events.some(event =>
        event.tick >= startTick &&
        event.tick <= endTick &&
        eventTypes.includes(event.eventType)
    );
}

function isPlayerAliveAtTick(steamId: bigint, tick: number): boolean {
    const frame = getPlayerFrameAtTick(steamId, tick);
    return frame?.isAlive ?? false;
}

function getActivePlantingStatus(events: BombEvent[], tick: number): string {
    const plantBegin = getLastBombEventBefore(events, 'plant_begin', tick);
    if (!plantBegin) return '';
    if (hasBombEventBetween(events, ['plant_aborted', 'planted'], plantBegin.tick, tick)) return '';
    if (plantBegin.playerSteamId !== 0n && !isPlayerAliveAtTick(plantBegin.playerSteamId, tick)) return '';

    const plantEndTick = getPlantEndTick(plantBegin, events);
    if (tick >= plantEndTick) return '';

    const secondsLeft = Math.max(0, Math.ceil((plantEndTick - tick) / getTickRate()));
    return `Planting Bomb ${secondsLeft}s`;
}

function getActiveDefuseStatus(events: BombEvent[], plantTick: number, tick: number): string {
    const defuseStart = getLastBombEventBefore(events, 'defuse_start', tick);
    if (!defuseStart || defuseStart.tick < plantTick) return '';
    if (hasBombEventBetween(events, ['defuse_aborted', 'defused', 'exploded'], defuseStart.tick, tick)) return '';
    if (defuseStart.playerSteamId !== 0n && !isPlayerAliveAtTick(defuseStart.playerSteamId, tick)) return '';

    const defuseSeconds = defuseStart.hasKit ? DEFUSE_SECONDS_WITH_KIT : DEFUSE_SECONDS_WITHOUT_KIT;
    const defuseEndTick = defuseStart.tick + Math.round(defuseSeconds * getTickRate());
    if (tick >= defuseEndTick) return '';

    const secondsLeft = Math.max(0, Math.ceil((defuseEndTick - tick) / getTickRate()));
    return `Defusing Bomb ${secondsLeft}s`;
}

function getRoundEndBombStatus(round: RoundData, tick: number): BombStatus | null {
    if (tick < getRoundDisplayEndTick(replayData, round)) return null;

    if (round.winReason === 'bomb_detonated') {
        return {
            bombText: 'Bomb exploded, Terrorists Win!',
            bombClass: 'bomb-label-t',
            defuseText: '',
            defuseClass: '',
        };
    }

    if (round.winReason === 'bomb_defused') {
        return {
            bombText: '',
            bombClass: '',
            defuseText: 'Bomb has been defused. Counter Terrorists Win',
            defuseClass: 'bomb-label-ct',
        };
    }

    return null;
}

function getBombStatus(tick: number): BombStatus {
    const round = getCurrentRoundData(tick) ?? getPlaybackStartRound(tick);
    if (!round) return emptyBombStatus();

    const events = getBombEventsForRound(round);
    const roundEndStatus = getRoundEndBombStatus(round, tick);
    const plant = getLastBombEventBefore(events, 'planted', tick);
    const fallbackPlantTick = getFallbackBombPlantTick(round, events);
    const plantTick = plant?.tick ?? (fallbackPlantTick > 0 && tick >= fallbackPlantTick ? fallbackPlantTick : 0);
    const plantingText = getActivePlantingStatus(events, tick);
    if (!plantTick) {
        return plantingText
            ? {
                bombText: plantingText,
                bombClass: 'bomb-label-t',
                defuseText: '',
                defuseClass: '',
            }
            : roundEndStatus ?? emptyBombStatus();
    }

    const exploded = getLastBombEventBefore(events, 'exploded', tick);
    if (exploded && exploded.tick >= plantTick) {
        return {
            bombText: 'Bomb exploded, Terrorists Win!',
            bombClass: 'bomb-label-t',
            defuseText: '',
            defuseClass: '',
        };
    }
    if (roundEndStatus?.bombText) return roundEndStatus;

    const defused = getLastBombEventBefore(events, 'defused', tick);
    if (defused && defused.tick >= plantTick) {
        return {
            bombText: '',
            bombClass: '',
            defuseText: 'Bomb has been defused. Counter Terrorists Win',
            defuseClass: 'bomb-label-ct',
        };
    }
    if (roundEndStatus?.defuseText) return roundEndStatus;

    const countdownEndTick = getBombCountdownEndTick(plantTick, round);
    const secondsLeft = Math.max(0, Math.ceil((countdownEndTick - tick) / getTickRate()));
    const defuseText = getActiveDefuseStatus(events, plantTick, tick);

    return {
        bombText: `Bomb has been Planted ${secondsLeft}s`,
        bombClass: 'bomb-label-t',
        defuseText,
        defuseClass: defuseText ? 'bomb-label-ct' : '',
    };
}

function deselectPlayerPreservingViewport(keepDrag = false): void {
    if (selectedPlayerSteamId === null) return;
    const retainedTransform = getReplayViewportTransform();
    selectedPlayerSteamId = null;
    mouseViewportZoomScale = Math.max(1, retainedTransform.scale);
    mouseViewportTranslateX = retainedTransform.translateX;
    mouseViewportTranslateY = retainedTransform.translateY;
    if (!keepDrag) mouseViewportDrag = null;
    if (!keepDrag) ignoreNextCanvasClick = false;
    preserveUnconstrainedViewport = true;
    timelineEventsKey = '';
    updateReplayViewportTransform();
}

function selectPlayer(steamId: bigint): void {
    if (selectedPlayerSteamId === steamId) {
        deselectPlayerPreservingViewport();
    } else {
        selectedPlayerSteamId = steamId;
        resetMouseViewportZoom();
        timelineEventsKey = '';
        updateReplayViewportTransform();
    }
}

function focusPlayer(steamId: bigint): void {
    selectedPlayerSteamId = steamId;
    resetMouseViewportZoom();
    timelineEventsKey = '';
    updateReplayViewportTransform();
}

function isSelectedPlayer(steamId: bigint): boolean {
    return selectedPlayerSteamId === steamId;
}

function setNoiseSourceEnabled(source: NoiseSourceKey, enabled: boolean): void {
    enabledNoiseSources = {
        ...enabledNoiseSources,
        [source]: enabled,
    };
}

function setTimelineUtilityEnabled(source: TimelineUtilityKey, enabled: boolean): void {
    enabledTimelineUtilities = {
        ...enabledTimelineUtilities,
        [source]: enabled,
    };
    timelineEventsKey = '';
}

function setTimelineCombatEventEnabled(eventType: TimelineCombatEventKey, enabled: boolean): void {
    enabledTimelineCombatEvents = {
        ...enabledTimelineCombatEvents,
        [eventType]: enabled,
    };
    timelineEventsKey = '';
}

function clearAllDrawings(): void {
    drawingClearSignal += 1;
}

function handleTimelineEventClick(event: PlayerTimelineEvent): void {
    const eventPlayerSteamId = event.playerSteamId;
    if (
        eventPlayerSteamId &&
        eventPlayerSteamId !== 0n &&
        (isTimelineUtilityType(event.type) || event.type === 'kill' || event.type === 'death' || event.type === 'bomb_planted' || event.type === 'bomb_defused')
    ) {
        focusPlayer(eventPlayerSteamId);
    }

    seekToPlayerEvent(event.tick);
}

function setMapVariant(variant: MapVariant): void {
    if (variant === mapVariant) return;
    if (variant === 'lower' && !hasLowerMapVariant) return;
    mapVariant = variant;
}

function getTickRate(): number {
    return replayData?.header?.tickRate || 64;
}

function getEventSeekLeadTicks(): number {
    return Math.round(getTickRate() * EVENT_SEEK_LEAD_SECONDS);
}

function getEventLeadTick(eventTick: number): number {
    const round = getRoundForTick(eventTick);
    const minTick = round?.startTick ?? 0;
    return Math.max(minTick, eventTick - getEventSeekLeadTicks());
}

function getDeadPlayerLeadTick(deathTick: number): number {
    const round = getRoundForTick(deathTick);
    const minTick = round?.startTick ?? 0;
    return Math.max(minTick, deathTick - Math.round(getTickRate() * DEAD_PLAYER_SEEK_LEAD_SECONDS));
}

function seekToPlayerEvent(eventTick: number): void {
    setTick(getEventLeadTick(eventTick));
}

function handleKillFeedSelect(kill: KillEvent): void {
    if (kill.killerSteamId !== 0n) {
        focusPlayer(kill.killerSteamId);
    }
    seekToPlayerEvent(kill.tick);
}

function showToast(message: string): void {
    toastMessage = message;
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toastMessage = '';
        toastTimeout = null;
    }, TOAST_DURATION_MS);
}

async function copyTickCommand(eventTick: number): Promise<void> {
    const targetTick = getEventLeadTick(eventTick);
    await copyExactTickCommand(targetTick);
}

async function copyExactTickCommand(targetTick: number): Promise<void> {
    const command = `demo_goto ${targetTick}`;

    try {
        await navigator.clipboard.writeText(command);
        showToast(`Copied ${command}`);
    } catch (error) {
        console.error('Failed to copy tick command:', error);
        showToast('Could not copy tick command');
    }
}

function getSelectedPlayerZoomScale(): number {
    return Math.max(1, Math.min(5, selectedPlayerZoomPercent / 100));
}

function getSelectedPlayerViewportTransform(tick = getPlaybackTick()): ViewportTransform {
    if (selectedPlayerSteamId === null || !replayData || !replayContainer) {
        return { scale: 1, translateX: 0, translateY: 0 };
    }

    const zoom = getSelectedPlayerZoomScale();
    if (zoom <= 1) {
        return { scale: 1, translateX: 0, translateY: 0 };
    }

    const selectedFrame = getPlayerFrameAtTick(selectedPlayerSteamId, tick);
    if (!selectedFrame) {
        return { scale: 1, translateX: 0, translateY: 0 };
    }

    const rect = replayContainer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return { scale: 1, translateX: 0, translateY: 0 };
    }

    const focus = worldToCanvas(selectedFrame.x, selectedFrame.y, mapMetadata, {
        width: rect.width,
        height: rect.height,
    });

    return {
        scale: zoom,
        translateX: rect.width / 2 - focus.x * zoom,
        translateY: rect.height / 2 - focus.y * zoom,
    };
}

function getReplayViewportTransform(tick = getPlaybackTick()): ViewportTransform {
    const selectedTransform = getSelectedPlayerViewportTransform(tick);
    const transform = {
        scale: mouseViewportZoomScale * selectedTransform.scale,
        translateX: mouseViewportTranslateX + mouseViewportZoomScale * selectedTransform.translateX,
        translateY: mouseViewportTranslateY + mouseViewportZoomScale * selectedTransform.translateY,
    };

    if (preserveUnconstrainedViewport || !replayContainer) return transform;

    const rect = replayContainer.getBoundingClientRect();
    return constrainViewportTransformToMap(transform, rect);
}

function constrainViewportTransformToMap(
    transform: ViewportTransform,
    viewport: { width: number; height: number }
): ViewportTransform {
    const mapWidth = mapMetadata.width || 1024;
    const mapHeight = mapMetadata.height || 1024;
    if (viewport.width <= 0 || viewport.height <= 0 || mapWidth <= 0 || mapHeight <= 0) {
        return transform;
    }

    const displayScale = Math.min(viewport.width / mapWidth, viewport.height / mapHeight) * MAP_CANVAS_MARGIN;
    const displayedMapWidth = mapWidth * displayScale;
    const displayedMapHeight = mapHeight * displayScale;
    const mapLeft = (viewport.width - displayedMapWidth) / 2;
    const mapTop = (viewport.height - displayedMapHeight) / 2;
    const scaledMapWidth = displayedMapWidth * transform.scale;
    const scaledMapHeight = displayedMapHeight * transform.scale;
    const horizontalPadding = Math.max(
        viewport.width * MAP_PAN_VIEWPORT_PADDING,
        scaledMapWidth * MAP_PAN_MAP_PADDING
    );
    const verticalPadding = Math.max(
        viewport.height * MAP_PAN_VIEWPORT_PADDING,
        scaledMapHeight * MAP_PAN_MAP_PADDING
    );
    const minTranslateX = viewport.width - (mapLeft + displayedMapWidth) * transform.scale - horizontalPadding;
    const maxTranslateX = -mapLeft * transform.scale + horizontalPadding;
    const minTranslateY = viewport.height - (mapTop + displayedMapHeight) * transform.scale - verticalPadding;
    const maxTranslateY = -mapTop * transform.scale + verticalPadding;
    const translateX = minTranslateX <= maxTranslateX
        ? Math.max(minTranslateX, Math.min(maxTranslateX, transform.translateX))
        : viewport.width / 2 - (mapLeft + displayedMapWidth / 2) * transform.scale;
    const translateY = minTranslateY <= maxTranslateY
        ? Math.max(minTranslateY, Math.min(maxTranslateY, transform.translateY))
        : viewport.height / 2 - (mapTop + displayedMapHeight / 2) * transform.scale;

    return { ...transform, translateX, translateY };
}

function constrainMouseViewportTranslation(): void {
    if (!replayContainer) return;

    const selectedTransform = getSelectedPlayerViewportTransform();
    const clampedTransform = constrainViewportTransformToMap(
        {
            scale: mouseViewportZoomScale * selectedTransform.scale,
            translateX: mouseViewportTranslateX + mouseViewportZoomScale * selectedTransform.translateX,
            translateY: mouseViewportTranslateY + mouseViewportZoomScale * selectedTransform.translateY,
        },
        replayContainer.getBoundingClientRect()
    );

    mouseViewportTranslateX = clampedTransform.translateX - mouseViewportZoomScale * selectedTransform.translateX;
    mouseViewportTranslateY = clampedTransform.translateY - mouseViewportZoomScale * selectedTransform.translateY;
}

function resetReplayViewportTransform(): void {
    replayContainer?.style.setProperty('--replay-viewport-transform', 'none');
}

function updateReplayViewportTransform(tick = getPlaybackTick()): void {
    if (!browser || !replayContainer) return;

    const transform = getReplayViewportTransform(tick);
    if (
        transform.scale <= 1 &&
        Math.abs(transform.translateX) < 0.01 &&
        Math.abs(transform.translateY) < 0.01
    ) {
        resetReplayViewportTransform();
        return;
    }

    replayContainer.style.setProperty(
        '--replay-viewport-transform',
        `translate(${transform.translateX.toFixed(2)}px, ${transform.translateY.toFixed(2)}px) scale(${transform.scale.toFixed(3)})`
    );
}

function resetMouseViewportZoom(): void {
    mouseViewportZoomScale = 1;
    mouseViewportTranslateX = 0;
    mouseViewportTranslateY = 0;
    mouseViewportDrag = null;
    ignoreNextCanvasClick = false;
    preserveUnconstrainedViewport = false;
}

function handleViewportWheel(event: WheelEvent): void {
    if (viewMode !== '2d') return;
    if (!(event.target instanceof HTMLCanvasElement) || !replayContainer) return;

    event.preventDefault();

    if (selectedPlayerSteamId !== null) {
        const nextZoomScale = Math.max(
            1,
            Math.min(MAX_MOUSE_VIEWPORT_ZOOM_SCALE, getSelectedPlayerZoomScale() * Math.exp(-event.deltaY * 0.0015))
        );
        selectedPlayerZoomPercent = nextZoomScale * 100;
        preserveUnconstrainedViewport = false;
        updateReplayViewportTransform();
        return;
    }

    const rect = replayContainer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const currentTransform = getReplayViewportTransform();
    const sourceX = (pointerX - currentTransform.translateX) / currentTransform.scale;
    const sourceY = (pointerY - currentTransform.translateY) / currentTransform.scale;
    const nextZoomScale = Math.max(
        1,
        Math.min(MAX_MOUSE_VIEWPORT_ZOOM_SCALE, mouseViewportZoomScale * Math.exp(-event.deltaY * 0.0015))
    );

    if (nextZoomScale === mouseViewportZoomScale) return;

    preserveUnconstrainedViewport = false;

    if (nextZoomScale <= 1) {
        resetMouseViewportZoom();
        updateReplayViewportTransform();
        return;
    }

    const selectedTransform = getSelectedPlayerViewportTransform();
    mouseViewportZoomScale = nextZoomScale;
    mouseViewportTranslateX = pointerX
        - sourceX * nextZoomScale * selectedTransform.scale
        - nextZoomScale * selectedTransform.translateX;
    mouseViewportTranslateY = pointerY
        - sourceY * nextZoomScale * selectedTransform.scale
        - nextZoomScale * selectedTransform.translateY;
    constrainMouseViewportTranslation();
    updateReplayViewportTransform();
}

function handleViewportPointerDown(event: PointerEvent): void {
    if (viewMode !== '2d') return;
    if (event.button === 0) {
        ignoreNextCanvasClick = false;
    }

    if (
        isDrawingShortcutActive ||
        event.button !== 0 ||
        !(event.target instanceof HTMLCanvasElement)
    ) {
        return;
    }

    const currentTransform = getReplayViewportTransform();
    const deselectPlayerOnMove = selectedPlayerSteamId !== null;
    mouseViewportDrag = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startTranslateX: deselectPlayerOnMove ? currentTransform.translateX : mouseViewportTranslateX,
        startTranslateY: deselectPlayerOnMove ? currentTransform.translateY : mouseViewportTranslateY,
        deselectPlayerOnMove,
        hasMoved: false,
    };
    event.target.setPointerCapture(event.pointerId);
}

function handleViewportPointerMove(event: PointerEvent): void {
    if (viewMode !== '2d') return;
    if (!mouseViewportDrag || event.pointerId !== mouseViewportDrag.pointerId) return;

    const deltaX = event.clientX - mouseViewportDrag.startClientX;
    const deltaY = event.clientY - mouseViewportDrag.startClientY;
    if (!mouseViewportDrag.hasMoved && Math.hypot(deltaX, deltaY) < 2) return;

    mouseViewportDrag.hasMoved = true;
    if (mouseViewportDrag.deselectPlayerOnMove) {
        deselectPlayerPreservingViewport(true);
        mouseViewportDrag.deselectPlayerOnMove = false;
    }
    preserveUnconstrainedViewport = false;
    mouseViewportTranslateX = mouseViewportDrag.startTranslateX + deltaX;
    mouseViewportTranslateY = mouseViewportDrag.startTranslateY + deltaY;
    constrainMouseViewportTranslation();
    updateReplayViewportTransform();
}

function finishViewportPointerDrag(event: PointerEvent): void {
    if (viewMode !== '2d') return;
    if (!mouseViewportDrag || event.pointerId !== mouseViewportDrag.pointerId) return;

    ignoreNextCanvasClick = mouseViewportDrag.hasMoved;
    if (event.target instanceof HTMLCanvasElement && event.target.hasPointerCapture(event.pointerId)) {
        event.target.releasePointerCapture(event.pointerId);
    }
    mouseViewportDrag = null;
}

function attachViewportInteractions(element: HTMLDivElement): () => void {
    element.addEventListener('click', handleReplayCanvasClick);
    element.addEventListener('dblclick', handleReplayCanvasDoubleClick);
    element.addEventListener('wheel', handleViewportWheel, { passive: false });
    element.addEventListener('pointerdown', handleViewportPointerDown);
    element.addEventListener('pointermove', handleViewportPointerMove);
    element.addEventListener('pointerup', finishViewportPointerDrag);
    element.addEventListener('pointercancel', finishViewportPointerDrag);

    return () => {
        element.removeEventListener('click', handleReplayCanvasClick);
        element.removeEventListener('dblclick', handleReplayCanvasDoubleClick);
        element.removeEventListener('wheel', handleViewportWheel);
        element.removeEventListener('pointerdown', handleViewportPointerDown);
        element.removeEventListener('pointermove', handleViewportPointerMove);
        element.removeEventListener('pointerup', finishViewportPointerDrag);
        element.removeEventListener('pointercancel', finishViewportPointerDrag);
    };
}

function getReplayCanvasPoint(event: MouseEvent): { x: number; y: number; tick: number } | null {
    if (viewMode !== '2d') return null;
    if (!(event.target instanceof HTMLCanvasElement) || !replayContainer) return null;
    const rect = replayContainer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const transform = getReplayViewportTransform();
    return {
        x: (event.clientX - rect.left - transform.translateX) / transform.scale,
        y: (event.clientY - rect.top - transform.translateY) / transform.scale,
        tick: getPlaybackTick(),
    };
}

function getDeathAtTick(steamId: bigint, tick: number): KillEvent | null {
    let death: KillEvent | null = null;
    for (const kill of replayData?.kills ?? []) {
        if (kill.victimSteamId !== steamId || kill.tick > tick) continue;
        if (!death || kill.tick > death.tick) death = kill;
    }
    return death;
}

function focusDeadPlayerAtTick(steamId: bigint, tick: number): void {
    const death = getDeathAtTick(steamId, tick);
    focusPlayer(steamId);
    if (death) seekToPlayerEvent(death.tick);
}

function handleRosterPlayerClick(entry: RosterEntry): void {
    if (entry.isAlive) selectPlayer(entry.player.steamId);
    else focusDeadPlayerAtTick(entry.player.steamId, getPlaybackTick());
}

function scheduleNadeTickCopy(interaction: { throwTick: number; throwerSteamId: bigint }): void {
    if (nadeClickTimeout) clearTimeout(nadeClickTimeout);
    nadeClickTimeout = setTimeout(() => {
        nadeClickTimeout = null;
        void copyTickCommand(interaction.throwTick);
    }, NADE_SINGLE_CLICK_DELAY_MS);
}

function getDeadPlayerInteractionAtCanvasPoint(
    x: number,
    y: number,
    tick: number
): { deathTick: number; steamId: bigint } | null {
    if (!replayContainer) return null;

    let closestDeathTick: number | null = null;
    let closestSteamId: bigint | null = null;
    let closestDistanceSquared = PLAYER_DOT_CLICK_RADIUS * PLAYER_DOT_CLICK_RADIUS;
    for (const player of playablePlayers) {
        const frame = getPlayerFrameAtTick(player.steamId, tick);
        if (!frame || (frame.isAlive ?? true)) continue;

        const position = worldToCanvas(frame.x, frame.y, mapMetadata, {
            width: replayContainer.clientWidth,
            height: replayContainer.clientHeight,
        });
        const distanceX = x - position.x;
        const distanceY = y - position.y;
        const distanceSquared = distanceX * distanceX + distanceY * distanceY;
        if (distanceSquared > closestDistanceSquared) continue;

        const death = getDeathAtTick(player.steamId, tick);
        if (!death) continue;
        closestDistanceSquared = distanceSquared;
        closestDeathTick = death.tick;
        closestSteamId = player.steamId;
    }

    if (closestDeathTick === null || closestSteamId === null) return null;
    return { deathTick: closestDeathTick, steamId: closestSteamId };
}

function scheduleDeadIconTickCopy(deathTick: number): void {
    if (deadIconClickTimeout) clearTimeout(deadIconClickTimeout);
    deadIconClickTimeout = setTimeout(() => {
        deadIconClickTimeout = null;
        void copyExactTickCommand(getDeadPlayerLeadTick(deathTick));
    }, DEAD_ICON_SINGLE_CLICK_DELAY_MS);
}

function handleReplayCanvasDoubleClick(event: MouseEvent): void {
    const point = getReplayCanvasPoint(event);
    if (!point) return;
    const interaction = nadeLayer?.getNadeInteractionAtCanvasPoint(point.x, point.y, point.tick) ?? null;
    if (!interaction) {
        const deadPlayerInteraction = getDeadPlayerInteractionAtCanvasPoint(point.x, point.y, point.tick);
        if (!deadPlayerInteraction) return;
        event.preventDefault();
        event.stopPropagation();
        if (deadIconClickTimeout) {
            clearTimeout(deadIconClickTimeout);
            deadIconClickTimeout = null;
        }
        focusPlayer(deadPlayerInteraction.steamId);
        setTick(getDeadPlayerLeadTick(deadPlayerInteraction.deathTick));
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (nadeClickTimeout) {
        clearTimeout(nadeClickTimeout);
        nadeClickTimeout = null;
    }
    if (interaction.throwerSteamId !== 0n) focusPlayer(interaction.throwerSteamId);
    seekToPlayerEvent(interaction.throwTick);
}

function handleReplayCanvasClick(event: MouseEvent): void {
    if (ignoreNextCanvasClick) {
        ignoreNextCanvasClick = false;
        return;
    }
    if (isDrawingShortcutActive) return;
    const point = getReplayCanvasPoint(event);
    if (!point || !replayContainer) return;

    const nadeInteraction = nadeLayer?.getNadeInteractionAtCanvasPoint(point.x, point.y, point.tick) ?? null;
    if (nadeInteraction) {
        event.preventDefault();
        event.stopPropagation();
        scheduleNadeTickCopy(nadeInteraction);
        return;
    }

    const deadPlayerInteraction = getDeadPlayerInteractionAtCanvasPoint(point.x, point.y, point.tick);
    if (deadPlayerInteraction) {
        event.preventDefault();
        event.stopPropagation();
        scheduleDeadIconTickCopy(deadPlayerInteraction.deathTick);
        return;
    }

    let closestSteamId: bigint | null = null;
    let closestFrame: PlayerFrame | null = null;
    let closestDistanceSquared = PLAYER_DOT_CLICK_RADIUS * PLAYER_DOT_CLICK_RADIUS;

    for (const player of playablePlayers) {
        const frame = getPlayerFrameAtTick(player.steamId, point.tick);
        if (!frame) continue;

        const playerPosition = worldToCanvas(frame.x, frame.y, mapMetadata, {
            width: replayContainer.clientWidth,
            height: replayContainer.clientHeight,
        });
        const distanceX = point.x - playerPosition.x;
        const distanceY = point.y - playerPosition.y;
        const distanceSquared = distanceX * distanceX + distanceY * distanceY;

        if (distanceSquared <= closestDistanceSquared) {
            closestSteamId = player.steamId;
            closestFrame = frame;
            closestDistanceSquared = distanceSquared;
        }
    }

    if (closestSteamId !== null) {
        if (!closestFrame || (closestFrame.isAlive ?? true)) selectPlayer(closestSteamId);
    } else if (selectedPlayerSteamId !== null) {
        deselectPlayerPreservingViewport();
    }
}

function syncDisplayTick(force = false, timestamp = performance.now()) {
    if (!force && timestamp - lastDisplayUpdateTime < DISPLAY_UPDATE_INTERVAL_MS) return;

    const nextTick = Math.floor(getPlaybackTick());
    if (force || nextTick !== displayTick) {
        displayTick = nextTick;
    }
    lastDisplayUpdateTime = timestamp;
}

function playbackLoop(timestamp: number) {
    if (!replayData) { rafId = null; return; }

    const elapsed = (timestamp - playbackRefTime) / 1000;
    const tickRate = replayData.header?.tickRate || 64;
    const round = getCurrentRoundData(Math.floor(getPlaybackTick()));
    const maxTick = round ? getRoundDisplayEndTick(replayData, round) : (replayData.header?.totalTicks || 1) - 1;

    const targetFloat = playbackRefTick + elapsed * tickRate * playbackSpeed;

    if (targetFloat >= maxTick) {
        setTick(maxTick);
        setPlaying(false);
        return;
    }

    setPlaybackTick(targetFloat);
    replay3DScene?.setTick(targetFloat);
    updateReplayViewportTransform(targetFloat);
    syncDisplayTick(false, timestamp);

    rafId = requestAnimationFrame(playbackLoop);
}

// Update timeline fill and active start whenever tick or round changes
$: {
    void displayTick, replayData;
    const round = getCurrentRoundData(displayTick);
    if (round) {
        const as = getRoundActiveStart(round);
        const tickInRound = displayTick - as;
        const roundDuration = getRoundDisplayEndTick(replayData, round) - as;
        const progress = roundDuration > 0 ? (tickInRound / roundDuration) * 100 : 0;
        roundProgressPct = Math.max(0, Math.min(100, progress));
        activeStart = as;
    } else {
        roundProgressPct = 0;
        activeStart = 0;
    }
}

$: {
    void selectedPlayerSteamId, playablePlayers, displayTick;
    if (
        selectedPlayerSteamId !== null &&
        (
            !playablePlayers.some(player => player.steamId === selectedPlayerSteamId) ||
            !(getPlayerFrameAtTick(selectedPlayerSteamId, displayTick)?.isAlive ?? false)
        )
    ) {
        deselectPlayerPreservingViewport();
    }
}

$: {
    void replayData, displayTick, playablePlayers;
    const round = getCurrentRoundData(displayTick) ?? getPlaybackStartRound(displayTick);
    const rosterEntries = buildRosterEntries(round, displayTick);
    ctRoster = rosterEntries
        .filter(entry => entry.side === TEAM_CT)
        .sort(compareRosterEntriesByPlayerName);
    tRoster = rosterEntries
        .filter(entry => entry.side === TEAM_T)
        .sort(compareRosterEntriesByPlayerName);
    ctAliveCount = ctRoster.filter(entry => entry.isAlive).length;
    tAliveCount = tRoster.filter(entry => entry.isAlive).length;
    bombStatus = getBombStatus(displayTick);
    matchScore = buildMatchScore(displayTick, round);
}

$: {
    void replayData, displayTick, selectedPlayerSteamId, showAllTimelineUtilities, enabledTimelineUtilities, enabledTimelineCombatEvents;
    const round = getCurrentRoundData(displayTick) ?? getPlaybackStartRound(displayTick);
    updateTimelineEvents(round);
}

$: {
    void selectedPlayerZoomPercent, selectedPlayerSteamId, mouseViewportZoomScale, mouseViewportTranslateX, mouseViewportTranslateY, preserveUnconstrainedViewport, replayData, mapMetadata;
    updateReplayViewportTransform();
}

$: {
    void mapMetadata;
    hasLowerMapVariant = Boolean(getRadarInfo(mapMetadata?.name)?.verticalSections?.lower);
    if (!hasLowerMapVariant && mapVariant !== 'default') {
        mapVariant = 'default';
    }
}

$: {
    void viewMode;
    visibleToolbarSections = viewMode === '3d'
        ? TOOLBAR_SECTIONS
        : TOOLBAR_SECTIONS.filter(section => section.key !== 'camera');
}

$: {
    void showLineOfSight3D, lineOfSightLength3D, lineOfSightWidth3D, lineOfSightTransparency, selectedPlayerSteamId, viewerSettings;
    apply3DSceneSettings();
}

function startPlayback() {
    if (!browser || !replayData || rafId) return;

    let startTick = getPlaybackTick();
    const round = getPlaybackStartRound(Math.floor(startTick));
    if (round) {
        const activeStart = getRoundActiveStart(round);
        if (startTick < activeStart) {
            startTick = activeStart;
            setPlaybackTickAndNotify(startTick);
            syncDisplayTick(true);
        }
    }

    playbackRefTick = startTick;
    playbackRefTime = performance.now();
    lastDisplayUpdateTime = playbackRefTime;
    rafId = requestAnimationFrame(playbackLoop);
}

function stopPlayback() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    syncDisplayTick(true);
    notifyPlaybackTickChanged();
}

function setTick(tick: number) {
    const nextTick = Math.max(0, Math.floor(tick));
    if (getPlaybackTick() === nextTick) {
        syncDisplayTick(true);
        notifyPlaybackTickChanged();
        return;
    }

    setPlaybackTickAndNotify(nextTick);
    replay3DScene?.setTick(nextTick);
    syncDisplayTick(true);
    updateReplayViewportTransform(nextTick);
    if (isPlaying) {
        playbackRefTick = nextTick;
        playbackRefTime = performance.now();
        lastDisplayUpdateTime = playbackRefTime;
    }
}

function setPlaying(value: boolean) {
    if (value && !replayData) return;
    if (value === isPlaying) return;
    isPlaying = value;
    if (isPlaying) {
        startPlayback();
    } else {
        stopPlayback();
    }
}

function togglePlay() {
    setPlaying(!isPlaying);
}

function setSpeed(speed: number) {
    if (speed === playbackSpeed) return;
    if (isPlaying) {
        playbackRefTick = getPlaybackTick();
        playbackRefTime = performance.now();
        lastDisplayUpdateTime = playbackRefTime;
    }
    playbackSpeed = speed;
}

function toggleToolbarSection(section: ToolbarSectionKey, releaseToolbarFocus = false): void {
    if (
        releaseToolbarFocus &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement.classList.contains('toolbar-item')
    ) {
        document.activeElement.blur();
    }
    activeToolbarSection = activeToolbarSection === section ? null : section;
}

function getShortcut(actionId: string): string {
    return shortcutBindings[actionId] ?? '';
}

function publishShortcutBindings(nextBindings: Record<string, string>): void {
    shortcutBindings = nextBindings;
    shortcutBindingsStore.set(nextBindings);
}

function getRosterSlot(actionId: string): { side: 'ct' | 't'; index: number; entry?: RosterEntry } | null {
    const match = /^player-slot\.(ct|t)\.(\d+)$/.exec(actionId);
    if (!match) return null;
    const side = match[1] as 'ct' | 't';
    const index = Number(match[2]);
    const roster = side === 'ct' ? ctRoster : tRoster;
    return { side, index, entry: roster[index] };
}

function getShortcutLabel(actionId: string): string {
    if (actionId.startsWith('section.')) {
        const section = TOOLBAR_SECTIONS.find(candidate => candidate.key === actionId.slice(8));
        return `${section?.label ?? 'Control'} section`;
    }
    const rosterSlot = getRosterSlot(actionId);
    if (rosterSlot) {
        const sideLabel = rosterSlot.side.toUpperCase();
        return `Select ${sideLabel} Player ${rosterSlot.index + 1}`;
    }
    if (actionId.startsWith('noise.source.')) {
        const key = actionId.slice(13) as NoiseSourceKey;
        return NOISE_SOURCE_OPTIONS.find(option => option.key === key)?.label ?? 'Noise source';
    }
    if (actionId.startsWith('timeline.utility.')) {
        const key = actionId.slice(17) as TimelineUtilityKey;
        return TIMELINE_UTILITY_OPTIONS.find(option => option.key === key)?.label ?? 'Timeline utility';
    }
    if (actionId.startsWith('timeline.combat.')) {
        const key = actionId.slice(16) as TimelineCombatEventKey;
        return TIMELINE_COMBAT_EVENT_OPTIONS.find(option => option.key === key)?.label ?? 'Timeline event';
    }
    const labels: Record<string, string> = {
        'playback.load': 'Load demo',
        'playback.toggle': 'Play / pause',
        'map.normal': 'Normal map',
        'map.lower': 'Lower map',
        'sight.show-cone': 'Show Sight Cone',
        'sight.selected-only': 'Show Sight Cone for selected Player',
        'sight.width.decrease': 'Decrease Sight Cone Width',
        'sight.width.increase': 'Increase Sight Cone Width',
        'sight.length.decrease': 'Decrease Sight Cone Length',
        'sight.length.increase': 'Increase Sight Cone Length',
        'sight.show-los': 'Show Line of Sight',
        'sight.los-width.decrease': 'Decrease Line of Sight Width',
        'sight.los-width.increase': 'Increase Line of Sight Width',
        'sight.los-length.decrease': 'Decrease Line of Sight Length',
        'sight.los-length.increase': 'Increase Line of Sight Length',
        'sight.los-opacity.decrease': 'Decrease Line of Sight Transparency',
        'sight.los-opacity.increase': 'Increase Line of Sight Transparency',
        'camera.movement-speed.decrease': 'Decrease Camera Movement Speed',
        'camera.movement-speed.increase': 'Increase Camera Movement Speed',
        'camera.zoom-speed.decrease': 'Decrease Camera Zoom Speed',
        'camera.zoom-speed.increase': 'Increase Camera Zoom Speed',
        'player.zoom.decrease': 'Decrease Player Selection Zoom',
        'player.zoom.increase': 'Increase Player Selection Zoom',
        'noise.show': 'Show Noise Circle',
        'noise.selected-only': 'Noise for Selected Player',
        'timeline.show-all-utilities': 'Show all Utilities',
        'equipment.weapons': 'Show Dropped Weapons',
        'equipment.utility': 'Show Dropped Utility',
        'equipment.c4': 'Show Dropped C4',
        'drawing.setup': 'Drawing Setup',
        'drawing.stroke.decrease': 'Decrease Drawing Stroke Width',
        'drawing.stroke.increase': 'Increase Drawing Stroke Width',
        'drawing.mode.permanent': 'Permanent Drawings',
        'drawing.mode.fade': 'Fading Drawings',
        'drawing.fade.decrease': 'Decrease Drawing Fade Time',
        'drawing.fade.increase': 'Increase Drawing Fade Time',
        'drawing.clear': 'Clear all Drawings',
    };
    return labels[actionId] ?? actionId;
}

function startShortcutCapture(actionId: string): void {
    shortcutCaptureActionId = actionId;
    pendingCaptureKeyboardShortcut = null;
    if (actionId === 'drawing.setup') {
        isDrawingShortcutActive = false;
        drawingShortcutHeldCodes.clear();
        showToast('Press and release a keyboard shortcut for Drawing Setup, or Escape to cancel');
        return;
    }
    showToast(`Press a key or mouse input for ${getShortcutLabel(actionId)}`);
}

function isShortcutConflict(error: unknown): error is ShortcutConflict {
    return Boolean(
        error &&
        typeof error === 'object' &&
        'shortcut' in error &&
        'label' in error
    );
}

async function captureShortcut(shortcut: string): Promise<void> {
    const actionId = shortcutCaptureActionId;
    if (!actionId) return;

    try {
        const record = await assignShortcut(actionId, getShortcutLabel(actionId), shortcut);
        publishShortcutBindings({ ...shortcutBindings, [actionId]: record.shortcut });
        shortcutCaptureActionId = null;
        pendingCaptureKeyboardShortcut = null;
        showToast(`${shortcutForDisplay(shortcut)} assigned to ${record.label}`);
    } catch (error) {
        if (isShortcutConflict(error)) {
            showToast(`${shortcutForDisplay(shortcut)} is already used by ${error.label}. Try another input.`);
            return;
        }
        console.error('Failed to assign shortcut:', error);
        showToast('Could not save the shortcut. Try another input.');
    }
}

async function deleteShortcut(actionId: string): Promise<void> {
    try {
        await removeShortcut(actionId);
        const nextBindings = { ...shortcutBindings };
        delete nextBindings[actionId];
        publishShortcutBindings(nextBindings);
        if (shortcutCaptureActionId === actionId) shortcutCaptureActionId = null;
        if (actionId === 'drawing.setup') {
            isDrawingShortcutActive = false;
            drawingShortcutHeldCodes.clear();
        }
        showToast(`Shortcut removed from ${getShortcutLabel(actionId)}`);
    } catch (error) {
        console.error('Failed to remove shortcut:', error);
        showToast('Could not remove the shortcut');
    }
}

async function initializeShortcuts(): Promise<void> {
    try {
        const records = await loadShortcutRecords();
        const obsoleteRecords = records.filter(record =>
            record.actionId.startsWith('playback.speed.') || /^player\.\d+$/.test(record.actionId)
        );
        await Promise.all(obsoleteRecords.map(record => removeShortcut(record.actionId)));
        const obsoleteActionIds = new Set(obsoleteRecords.map(record => record.actionId));
        let activeRecords = records.filter(record => !obsoleteActionIds.has(record.actionId));
        const mouseDrawingRecord = activeRecords.find(record =>
            record.actionId === 'drawing.setup' && record.shortcut.includes('MOUSE_')
        );
        if (mouseDrawingRecord) {
            const keyboardDrawingRecord = await assignShortcut('drawing.setup', 'Drawing Setup', 'SHIFT');
            activeRecords = activeRecords.map(record =>
                record.actionId === 'drawing.setup' ? keyboardDrawingRecord : record
            );
        }
        publishShortcutBindings(Object.fromEntries(activeRecords.map(record => [record.actionId, record.shortcut])));
    } catch (error) {
        console.error('Failed to load shortcut database:', error);
        showToast('Shortcuts could not be loaded from the local database');
    }
}

function clampStep(value: number, direction: -1 | 1, step: number, min: number, max: number): number {
    const next = Math.max(min, Math.min(max, value + direction * step));
    const precision = Math.max(0, (step.toString().split('.')[1] ?? '').length);
    return Number(next.toFixed(precision));
}

function executeShortcut(actionId: string): void {
    if (actionId.startsWith('section.')) {
        toggleToolbarSection(actionId.slice(8) as ToolbarSectionKey, true);
        return;
    }
    const rosterSlot = getRosterSlot(actionId);
    if (rosterSlot) {
        if (rosterSlot.entry) handleRosterPlayerClick(rosterSlot.entry);
        return;
    }
    if (actionId.startsWith('noise.source.')) {
        const key = actionId.slice(13) as NoiseSourceKey;
        setNoiseSourceEnabled(key, !enabledNoiseSources[key]);
        return;
    }
    if (actionId.startsWith('timeline.utility.')) {
        const key = actionId.slice(17) as TimelineUtilityKey;
        setTimelineUtilityEnabled(key, !enabledTimelineUtilities[key]);
        return;
    }
    if (actionId.startsWith('timeline.combat.')) {
        const key = actionId.slice(16) as TimelineCombatEventKey;
        setTimelineCombatEventEnabled(key, !enabledTimelineCombatEvents[key]);
        return;
    }
    switch (actionId) {
        case 'playback.load': void loadDemo(); break;
        case 'playback.toggle': togglePlay(); break;
        case 'map.normal': setMapVariant('default'); break;
        case 'map.lower': setMapVariant('lower'); break;
        case 'sight.show-cone': showSightCone = !showSightCone; break;
        case 'sight.selected-only': sightConeForSelectedPlayer = !sightConeForSelectedPlayer; break;
        case 'sight.width.decrease': sightConeHalfAngle = clampStep(sightConeHalfAngle, -1, 0.02, 0.16, 0.8); break;
        case 'sight.width.increase': sightConeHalfAngle = clampStep(sightConeHalfAngle, 1, 0.02, 0.16, 0.8); break;
        case 'sight.length.decrease': sightConeLength = clampStep(sightConeLength, -1, 1, 18, 240); break;
        case 'sight.length.increase': sightConeLength = clampStep(sightConeLength, 1, 1, 18, 240); break;
        case 'sight.show-los':
            if (viewMode === '3d') showLineOfSight3D = !showLineOfSight3D;
            else showLineOfSight = !showLineOfSight;
            break;
        case 'sight.los-width.decrease':
            if (viewMode === '3d') lineOfSightWidth3D = clampStep(lineOfSightWidth3D, -1, 1, 1, 50);
            else lineOfSightWidth = clampStep(lineOfSightWidth, -1, 0.1, 0.3, 3);
            break;
        case 'sight.los-width.increase':
            if (viewMode === '3d') lineOfSightWidth3D = clampStep(lineOfSightWidth3D, 1, 1, 1, 50);
            else lineOfSightWidth = clampStep(lineOfSightWidth, 1, 0.1, 0.3, 3);
            break;
        case 'sight.los-length.decrease':
            if (viewMode === '3d') lineOfSightLength3D = clampStep(lineOfSightLength3D, -1, 1, 18, 1100);
            else lineOfSightLength = clampStep(lineOfSightLength, -1, 1, 18, 800);
            break;
        case 'sight.los-length.increase':
            if (viewMode === '3d') lineOfSightLength3D = clampStep(lineOfSightLength3D, 1, 1, 18, 1100);
            else lineOfSightLength = clampStep(lineOfSightLength, 1, 1, 18, 800);
            break;
        case 'sight.los-opacity.decrease': lineOfSightTransparency = clampStep(lineOfSightTransparency, -1, 0.05, 0, 0.95); break;
        case 'sight.los-opacity.increase': lineOfSightTransparency = clampStep(lineOfSightTransparency, 1, 0.05, 0, 0.95); break;
        case 'camera.movement-speed.decrease': updateCameraSetting('cameraMovementSpeed', clampStep(viewerSettings.cameraMovementSpeed, -1, 2, 4, 100)); break;
        case 'camera.movement-speed.increase': updateCameraSetting('cameraMovementSpeed', clampStep(viewerSettings.cameraMovementSpeed, 1, 2, 4, 100)); break;
        case 'camera.zoom-speed.decrease': updateCameraSetting('cameraZoomSpeed', clampStep(viewerSettings.cameraZoomSpeed, -1, 0.1, 0.1, 3)); break;
        case 'camera.zoom-speed.increase': updateCameraSetting('cameraZoomSpeed', clampStep(viewerSettings.cameraZoomSpeed, 1, 0.1, 0.1, 3)); break;
        case 'player.zoom.decrease': selectedPlayerZoomPercent = clampStep(selectedPlayerZoomPercent, -1, 25, 100, 500); break;
        case 'player.zoom.increase': selectedPlayerZoomPercent = clampStep(selectedPlayerZoomPercent, 1, 25, 100, 500); break;
        case 'noise.show': showNoiseCircle = !showNoiseCircle; break;
        case 'noise.selected-only': noiseForSelectedPlayer = !noiseForSelectedPlayer; break;
        case 'timeline.show-all-utilities': showAllTimelineUtilities = !showAllTimelineUtilities; break;
        case 'equipment.weapons': showDroppedWeapons = !showDroppedWeapons; break;
        case 'equipment.utility': showDroppedUtility = !showDroppedUtility; break;
        case 'equipment.c4': showDroppedC4 = !showDroppedC4; break;
        case 'drawing.stroke.decrease': drawingStrokeWidth = clampStep(drawingStrokeWidth, -1, 1, 1, 10); break;
        case 'drawing.stroke.increase': drawingStrokeWidth = clampStep(drawingStrokeWidth, 1, 1, 1, 10); break;
        case 'drawing.mode.permanent': drawingMode = 'permanent'; break;
        case 'drawing.mode.fade': drawingMode = 'fade'; break;
        case 'drawing.fade.decrease': drawingFadeSeconds = clampStep(drawingFadeSeconds, -1, 1, 1, 6); break;
        case 'drawing.fade.increase': drawingFadeSeconds = clampStep(drawingFadeSeconds, 1, 1, 1, 6); break;
        case 'drawing.clear': clearAllDrawings(); break;
    }
}

function findShortcutAction(shortcut: string): string | null {
    const match = Object.entries(shortcutBindings).find(([, assigned]) => assigned === shortcut);
    if (!match || match[0].startsWith('system.')) return null;
    return match[0];
}

function seekToRound(round: RoundData) {
    if (round) {
        clearAllDrawings();
        setTick(getRoundActiveStart(round));
    }
}

function tryActivateDrawingShortcut(event: KeyboardEvent): void {
    const drawingShortcut = getShortcut('drawing.setup');
    if (!drawingShortcut) return;

    const candidate = shortcutFromKeyboardEvent(event, heldShortcutCodes)
        ?? modifierShortcutFromKeyboardEvent(event);
    if (candidate !== drawingShortcut) return;

    isDrawingShortcutActive = true;
    drawingShortcutHeldCodes = new Set(heldShortcutCodes);
}

function handleKeydown(e: KeyboardEvent) {
    heldShortcutCodes.add(e.code);

    if (shortcutCaptureActionId) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') {
            const cancelledActionId = shortcutCaptureActionId;
            shortcutCaptureActionId = null;
            pendingCaptureKeyboardShortcut = null;
            showToast(`Shortcut editing cancelled for ${getShortcutLabel(cancelledActionId)}`);
            return;
        }
        const shortcut = shortcutFromKeyboardEvent(e, heldShortcutCodes)
            ?? (shortcutCaptureActionId === 'drawing.setup' ? modifierShortcutFromKeyboardEvent(e) : null);
        if (shortcut) pendingCaptureKeyboardShortcut = { code: e.code, shortcut };
        return;
    }

    tryActivateDrawingShortcut(e);
    const shortcut = shortcutFromKeyboardEvent(e, heldShortcutCodes);
    if (!shortcut) return;
    const actionId = findShortcutAction(shortcut);
    if (actionId) {
        e.preventDefault();
        if (e.repeat && !SLIDER_SHORTCUT_ACTIONS.has(actionId)) return;
        if (actionId === 'drawing.setup') return;
        executeShortcut(actionId);
    }
}

function handleKeyup(e: KeyboardEvent) {
    if (
        shortcutCaptureActionId &&
        pendingCaptureKeyboardShortcut?.code === e.code
    ) {
        e.preventDefault();
        e.stopPropagation();
        const shortcut = pendingCaptureKeyboardShortcut.shortcut;
        pendingCaptureKeyboardShortcut = null;
        void captureShortcut(shortcut);
    }
    if (drawingShortcutHeldCodes.has(e.code)) {
        isDrawingShortcutActive = false;
        drawingShortcutHeldCodes.clear();
    }
    heldShortcutCodes.delete(e.code);
}

function handleShortcutMouseDown(event: MouseEvent): void {
    if (shortcutCaptureActionId) {
        event.preventDefault();
        event.stopPropagation();
        pendingCaptureKeyboardShortcut = null;
        if (shortcutCaptureActionId === 'drawing.setup') {
            showToast('Drawing Setup needs a keyboard shortcut. Try a key or press Escape to cancel.');
            return;
        }
        void captureShortcut(shortcutFromMouseEvent(event, heldShortcutCodes));
        return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-shortcut-editor], button, input, label, [role="button"]')) return;
    const actionId = findShortcutAction(shortcutFromMouseEvent(event, heldShortcutCodes));
    if (!actionId) return;
    event.preventDefault();
    event.stopPropagation();
    executeShortcut(actionId);
}

function handleShortcutWheel(event: WheelEvent): void {
    const shortcut = shortcutFromWheelEvent(event, heldShortcutCodes);
    if (shortcutCaptureActionId) {
        event.preventDefault();
        event.stopPropagation();
        pendingCaptureKeyboardShortcut = null;
        if (shortcutCaptureActionId === 'drawing.setup') {
            showToast('Drawing Setup needs a keyboard shortcut. Try a key or press Escape to cancel.');
            return;
        }
        void captureShortcut(shortcut);
        return;
    }

    const actionId = findShortcutAction(shortcut);
    if (!actionId) return;
    event.preventDefault();
    event.stopPropagation();
    executeShortcut(actionId);
}

function handleWindowBlur() {
    isDrawingShortcutActive = false;
    drawingShortcutHeldCodes.clear();
    heldShortcutCodes.clear();
    pendingCaptureKeyboardShortcut = null;
}

function suppressContextMenu(event: MouseEvent): void {
    event.preventDefault();
}

function handleViewportResize() {
    constrainMouseViewportTranslation();
    updateReplayViewportTransform();
    timelineEventsKey = '';
    const round = getCurrentRoundData(displayTick) ?? getPlaybackStartRound(displayTick);
    updateTimelineEvents(round);
}

onMount(() => {
    if (!browser) return;
    void initializeShortcuts();
    void loadViewerSettings().then((settings) => {
        viewerSettings = settings;
        apply3DSceneSettings();
    }).catch((error) => console.error('Failed to load viewer settings:', error));
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('keyup', handleKeyup);
    window.addEventListener('mousedown', handleShortcutMouseDown, true);
    window.addEventListener('wheel', handleShortcutWheel, { capture: true, passive: false });
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('contextmenu', suppressContextMenu);
    window.addEventListener('resize', handleViewportResize);
    updateReplayViewportTransform();
    return () => {
        window.removeEventListener('keydown', handleKeydown);
        window.removeEventListener('keyup', handleKeyup);
        window.removeEventListener('mousedown', handleShortcutMouseDown, true);
        window.removeEventListener('wheel', handleShortcutWheel, true);
        window.removeEventListener('blur', handleWindowBlur);
        window.removeEventListener('contextmenu', suppressContextMenu);
        window.removeEventListener('resize', handleViewportResize);
        if (rafId) cancelAnimationFrame(rafId);
        if (toastTimeout) clearTimeout(toastTimeout);
        if (nadeClickTimeout) clearTimeout(nadeClickTimeout);
        if (deadIconClickTimeout) clearTimeout(deadIconClickTimeout);
    };
});
</script>

<style>
.replay-container {
    --replay-viewport-transform: none;
    position: fixed;
    inset: 0;
    background: linear-gradient(135deg, #0f0f13, #1a1a24);
    overflow: hidden;
    border-radius: 0;
}

/* Timeline at top */
.timeline {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: var(--timeline-height, 86px);
    background: #1a1a24;
    border-bottom: 1px solid #2a2a40;
    padding: 0 20px;
    z-index: 100;
    box-sizing: border-box;
    padding-top: 10px;
    transition: height 0.16s ease;
}

.timeline-track {
    width: 100%;
    height: 20px;
    background: #2a2a40;
    border-radius: 10px;
    position: relative;
    cursor: pointer;
}

.timeline-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 20px;
    background: #4b8bde;
    border-radius: 10px;
    transition: width 0.1s ease;
}

.timeline-knob {
    position: absolute;
    top: 4px;
    width: 12px;
    height: 12px;
    background: #60a5fa;
    border-radius: 50%;
    cursor: pointer;
    transform: translateX(-50%);
    transition: all 0.1s ease;
}

.timeline-knob:hover {
    background: #93c5fd;
    width: 16px;
    height: 16px;
    top: 2px;
}

.event-marker-track {
    position: relative;
    height: calc(var(--timeline-height, 86px) - 38px);
    margin-top: 8px;
}

.event-marker {
    position: absolute;
    box-sizing: border-box;
    min-width: 20px;
    height: 16px;
    padding: 0 4px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 4px;
    background: var(--marker-color);
    color: #0f172a;
    font-size: 9px;
    font-weight: 800;
    line-height: 14px;
    text-align: center;
    cursor: pointer;
    transform: translateX(-50%);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
    transition: filter 0.12s ease, outline-color 0.12s ease, transform 0.12s ease;
    z-index: 1;
}

.event-marker.has-icon {
    width: 28px;
    height: 28px;
    padding: 1px;
    border-color: var(--marker-color);
    background: rgba(15, 23, 42, 0.92);
}

.event-marker-icon {
    display: block;
    width: 24px;
    height: 24px;
    margin: auto;
    background: var(--marker-color);
    -webkit-mask-image: var(--marker-icon-url);
    mask-image: var(--marker-icon-url);
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-size: contain;
    mask-size: contain;
}

.event-marker:hover,
.event-marker:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: 2px;
    filter: brightness(1.3) drop-shadow(0 0 6px var(--marker-color));
    transform: translateX(-50%) scale(1.18);
    z-index: 4;
}

.bomb-status {
    position: absolute;
    top: calc(var(--timeline-height, 86px) + 46px);
    left: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    transform: translateX(-50%);
    z-index: 112;
    pointer-events: none;
    -webkit-user-select: none;
    user-select: none;
}

.match-score-label {
    position: absolute;
    top: calc(var(--timeline-height, 86px) + 10px);
    left: 50%;
    z-index: 112;
    max-width: min(560px, calc(100vw - 40px));
    padding: 7px 14px;
    transform: translateX(-50%);
    border: 1px solid rgba(148, 163, 184, 0.34);
    border-radius: 5px;
    background: rgba(15, 23, 42, 0.88);
    color: #e2e8f0;
    font-size: 13px;
    font-weight: 800;
    overflow: hidden;
    pointer-events: none;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    -webkit-user-select: none;
    user-select: none;
}

.match-score-team.side-ct {
    color: #93c5fd;
}

.match-score-team.side-t {
    color: #fdba74;
}

.match-score-team.side-neutral {
    color: #e2e8f0;
}

.match-score-separator {
    color: #94a3b8;
    margin: 0 8px;
}

.bomb-label {
    padding: 5px 12px;
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.86);
    color: #ffffff;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.01em;
    white-space: nowrap;
}

.bomb-label-t {
    border: 1px solid rgba(249, 115, 22, 0.65);
    color: #fdba74;
}

.bomb-label-ct {
    border: 1px solid rgba(59, 130, 246, 0.68);
    color: #93c5fd;
}

.copy-toast {
    position: absolute;
    left: 50%;
    bottom: 74px;
    z-index: 130;
    padding: 8px 12px;
    transform: translateX(-50%);
    border: 1px solid rgba(148, 163, 184, 0.4);
    border-radius: 5px;
    background: rgba(15, 23, 42, 0.92);
    color: #e2e8f0;
    font-size: 13px;
    font-weight: 700;
    pointer-events: none;
    -webkit-user-select: none;
    user-select: none;
}

.control-toolbar {
    position: absolute;
    top: calc(var(--timeline-height, 86px) + 10px);
    bottom: 70px;
    left: 10px;
    z-index: 114;
    display: flex;
    width: 76px;
    flex-direction: column;
    padding: 7px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    background: rgba(18, 18, 27, 0.94);
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(10px);
}

.toolbar-item {
    position: relative;
    display: flex;
    min-height: 58px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 5px 2px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: #94a3b8;
}

.toolbar-item::before {
    position: absolute;
    top: 10px;
    bottom: 10px;
    left: -7px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: #60a5fa;
    content: '';
    opacity: 0;
}

.toolbar-item:hover,
.toolbar-item.active {
    border-color: rgba(96, 165, 250, 0.38);
    background: rgba(59, 130, 246, 0.16);
    color: #e0f2fe;
}

.toolbar-item:hover::before,
.toolbar-item.active::before {
    opacity: 1;
}

.toolbar-item:focus-visible {
    outline: 2px solid #93c5fd;
    outline-offset: -2px;
}

.toolbar-item.has-shortcut {
    min-height: 68px;
    gap: 2px;
}

.toolbar-item.donate {
    margin-top: auto;
    color: #93c5fd;
}

.toolbar-icon {
    display: grid;
    width: 25px;
    height: 25px;
    place-items: center;
}

.toolbar-icon svg,
.panel-close svg {
    width: 23px;
    height: 23px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
}

.toolbar-icon.paypal-icon {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #ffffff;
    color: #003087;
    font-family: Arial, sans-serif;
    font-size: 15px;
    font-style: italic;
    font-weight: 900;
}

.toolbar-label {
    width: 100%;
    overflow: hidden;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.toolbar-shortcut {
    display: block;
    max-width: 62px;
    min-height: 13px;
    overflow: hidden;
    color: #9fb6d4;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 13px;
    opacity: 0.92;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.toolbar-item.active .toolbar-shortcut,
.toolbar-item:hover .toolbar-shortcut {
    color: #bfdbfe;
    opacity: 1;
}

.control-panel {
    position: absolute;
    top: calc(var(--timeline-height, 86px) + 10px);
    bottom: 70px;
    left: 94px;
    z-index: 113;
    display: flex;
    width: 370px;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(96, 165, 250, 0.3);
    border-radius: 8px;
    background: rgba(24, 24, 35, 0.96);
    box-shadow: 16px 18px 40px rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(12px);
    animation: panel-enter 0.16s ease-out;
}

.control-panel-header {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px;
    min-height: 64px;
    padding: 9px 12px 9px 9px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    background: linear-gradient(90deg, rgba(59, 130, 246, 0.12), transparent 72%);
}

.panel-close {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 5px;
    background: #20202d;
    color: #cbd5e1;
}

.panel-close:hover,
.panel-close:focus-visible {
    border-color: #60a5fa;
    color: #ffffff;
}

.panel-eyebrow {
    color: #64748b;
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
}

.control-panel-header h2 {
    margin: 1px 0 0;
    color: #f1f5f9;
    font-size: 17px;
    font-weight: 800;
    line-height: 1.1;
}

.control-panel-scroll {
    min-height: 0;
    padding: 13px 14px 18px;
    overflow-y: auto;
}

@keyframes panel-enter {
    from { opacity: 0; transform: translateX(-8px); }
    to { opacity: 1; transform: translateX(0); }
}

.control-section + .control-section {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.controls-heading {
    margin-bottom: 9px;
    color: #cbd5e1;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    line-height: 1.2;
    text-transform: uppercase;
}

.control-row,
.button-control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 34px;
    padding: 4px 0;
}

.button-control-row + .button-control-row {
    margin-top: 5px;
}

.slider-control {
    margin-top: 10px;
    padding: 9px 10px 10px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 6px;
    background: rgba(15, 15, 23, 0.48);
}

.control-label-line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 7px;
    color: #cbd5e1;
    font-size: 11px;
    font-weight: 700;
}

.control-label-line output {
    color: #94a3b8;
    font-family: var(--font-mono);
    font-size: 10px;
}

.slider-input-line {
    display: flex;
    align-items: center;
    gap: 9px;
}

.slider-input-line input[type='range'] {
    min-width: 70px;
    width: 100%;
    accent-color: #60a5fa;
}

.drawing-color-control {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 38px;
    color: #cbd5e1;
    font-size: 11px;
    font-weight: 700;
}

.drawing-shortcut-row {
    margin-bottom: 5px;
    padding: 7px 9px;
    border: 1px solid rgba(96, 165, 250, 0.2);
    border-radius: 6px;
    background: rgba(59, 130, 246, 0.07);
}

.shortcut-control-label {
    color: #cbd5e1;
    font-size: 11px;
    font-weight: 700;
}

.drawing-color-control input[type='color'] {
    width: 40px;
    height: 28px;
    padding: 0;
    border: 1px solid rgba(148, 163, 184, 0.4);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
}

.drawing-mode-button {
    flex: 1 1 auto;
    min-height: 30px;
    border: 1px solid #3a3a50;
    border-radius: 4px;
    background: #20202d;
    color: #94a3b8;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 800;
}

.drawing-mode-button:hover,
.drawing-mode-button:focus-visible {
    border-color: #60a5fa;
    color: #e2e8f0;
}

.drawing-mode-button.selected {
    border-color: #3b82f6;
    background: #2563eb;
    color: #ffffff;
}

.drawing-hint {
    margin: 0 0 10px;
    color: #94a3b8;
    font-size: 11px;
    line-height: 1.35;
}

.panel-button {
    flex: 1 1 auto;
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid #3a3a50;
    border-radius: 4px;
    background: #2a2a40;
    color: #e2e8f0;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 800;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.panel-button:hover {
    background: #3a3a50;
    border-color: #475569;
}

.checkbox-control {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 700;
}

.checkbox-control input {
    width: 14px;
    height: 14px;
    accent-color: #60a5fa;
}

.checkbox-control input:disabled {
    opacity: 0.5;
}

.panel-description {
    margin: 0 0 8px;
    color: #94a3b8;
    font-size: 11px;
    line-height: 1.45;
}

@media (prefers-reduced-motion: reduce) {
    .control-panel { animation: none; }
}

.player-roster {
    position: absolute;
    top: calc(var(--timeline-height, 86px) + 10px);
    right: 20px;
    width: 520px;
    background: rgba(26, 26, 36, 0.9);
    border: 1px solid #2a2a40;
    border-radius: 8px;
    padding: 10px;
    z-index: 110;
}

.roster-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
}

.roster-title {
    margin-bottom: 7px;
    color: #94a3b8;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.roster-player {
    display: block;
    min-width: 0;
    width: auto;
    flex: 1 1 auto;
    height: 24px;
    margin: 0;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: rgba(42, 42, 64, 0.75);
    color: var(--player-color);
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    line-height: 22px;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background 0.12s ease, border-color 0.12s ease, filter 0.12s ease, outline-color 0.12s ease, transform 0.12s ease;
}

.roster-player-row {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    margin-bottom: 4px;
}

:global(.roster-player-row .shortcut-binding) {
    min-width: 24px;
}

:global(.roster-player-row .shortcut-key) {
    max-width: 76px;
}

.roster-player:hover,
.roster-player:focus-visible {
    position: relative;
    background: rgba(59, 130, 246, 0.18);
    border-color: var(--player-color);
    outline: 2px solid #ffffff;
    outline-offset: 2px;
    filter: brightness(1.3) drop-shadow(0 0 6px var(--player-color));
    transform: scale(1.06);
    z-index: 2;
}

.roster-player.selected {
    background: rgba(96, 165, 250, 0.22);
    border-color: #60a5fa;
}

.roster-player.dead {
    color: #6b7280;
    text-decoration: line-through;
}

/* Empty state */
.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    position: fixed;
    inset: 0;
    background: #0f0f13;
}

.empty-state-content {
    text-align: center;
}

.empty-state-title {
    font-size: 28px;
    font-weight: 700;
    color: #f1f5f9;
    margin-bottom: 12px;
}

.empty-state-text {
    font-size: 16px;
    color: #94a3b8;
    margin-bottom: 32px;
}

.empty-state-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 12px;
}

.load-button {
    padding: 14px 32px;
    font-size: 16px;
    font-weight: 600;
    background: #3b82f6;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
}

.load-button:hover {
    background: #2563eb;
    transform: scale(1.02);
}

.load-button:active {
    transform: scale(0.98);
}

.load-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
}

.donation-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 13px 24px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    background: linear-gradient(135deg, #003087, #0070ba);
    color: #ffffff;
    cursor: pointer;
    font-family: inherit;
    font-size: 15px;
    font-weight: 700;
    box-shadow: 0 8px 22px rgba(0, 48, 135, 0.24);
    transition: filter 0.15s ease, transform 0.1s ease;
}

.donation-button:hover {
    filter: brightness(1.12);
    transform: scale(1.02);
}

.donation-button:active {
    transform: scale(0.98);
}

.donation-button:focus-visible {
    outline: 2px solid #60a5fa;
    outline-offset: 3px;
}

.donation-button-icon {
    display: inline-grid;
    place-items: center;
    width: 23px;
    height: 23px;
    border-radius: 50%;
    background: #ffffff;
    color: #003087;
    font-family: Arial, sans-serif;
    font-size: 15px;
    font-style: italic;
    font-weight: 900;
}

.three-d-viewport {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    outline: none;
}

.three-d-loading,
.three-d-map-error {
    position: absolute;
    z-index: 20;
    top: 50%;
    left: 50%;
    display: grid;
    max-width: 520px;
    place-items: center;
    gap: 12px;
    padding: 18px 22px;
    transform: translate(-50%, -50%);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 8px;
    background: rgba(9, 13, 18, 0.86);
    color: #e2e8f0;
    text-align: center;
    pointer-events: none;
}

.three-d-map-error {
    border-color: rgba(248, 113, 113, 0.55);
    color: #fecaca;
}

.three-d-spinner {
    width: 42px;
    height: 42px;
    border: 4px solid rgba(226, 232, 240, 0.18);
    border-top-color: #60a5fa;
    border-radius: 50%;
    animation: three-d-spin 0.8s linear infinite;
}

@keyframes three-d-spin { to { transform: rotate(360deg); } }

.three-d-crosshair {
    position: absolute;
    z-index: 18;
    top: 50%;
    left: 50%;
    width: 22px;
    height: 22px;
    transform: translate(-50%, -50%);
    pointer-events: none;
}

.three-d-crosshair i {
    position: absolute;
    top: 10px;
    left: 4px;
    width: 14px;
    height: 2px;
    background: rgba(255, 255, 255, 0.82);
}

.three-d-crosshair i:last-child { transform: rotate(90deg); }

.camera-key-grid {
    display: grid;
    gap: 7px;
}

.camera-key-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 700;
}

.camera-key-row button {
    min-width: 86px;
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid #3a3a50;
    border-radius: 4px;
    background: #20202d;
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-weight: 800;
}

.camera-key-row button:hover,
.camera-key-row button.capturing {
    border-color: #60a5fa;
    background: rgba(59, 130, 246, 0.2);
}

</style>

{#if replayData}
<div
    class="replay-container"
    bind:this={replayContainer}
    style:--timeline-height={`${timelineHeight}px`}
    {@attach attachViewportInteractions}
>
    <!-- Timeline at top -->
    <div class="timeline">
        <div class="timeline-track"
            role="button"
            tabindex="0"
            onclick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const pct = x / rect.width;
                const round = getCurrentRoundData();
                if (round) {
                    const activeStart = getRoundActiveStart(round);
                    const roundDuration = getRoundDisplayEndTick(replayData, round) - activeStart;
                    setTick(Math.floor(pct * roundDuration) + activeStart);
                } else {
                    const totalTicks = replayData?.header?.totalTicks || 1;
                    setTick(Math.floor(pct * totalTicks));
                }
            }}
            onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.currentTarget.click();
                }
            }}>
            <div class="timeline-fill" style="width: {roundProgressPct}%;"></div>
            <div class="timeline-knob" style="left: {roundProgressPct}%;"></div>
        </div>
        <div class="event-marker-track">
            {#each timelineEvents as playerEvent (playerEvent.id)}
                <button
                    class={`event-marker${playerEvent.iconPath ? ' has-icon' : ''}`}
                    style:left={`${playerEvent.leftPct}%`}
                    style:top={`${playerEvent.lane * TIMELINE_MARKER_LANE_PITCH}px`}
                    style:--marker-color={playerEvent.color}
                    style:--marker-icon-url={playerEvent.iconPath ? `url("${playerEvent.iconPath}")` : 'none'}
                    title={playerEvent.title}
                    aria-label={playerEvent.title}
                    onclick={() => handleTimelineEventClick(playerEvent)}
                    ondblclick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void copyTickCommand(playerEvent.tick);
                    }}
                >
                    {#if playerEvent.iconPath}
                        <span class="event-marker-icon" aria-hidden="true"></span>
                    {:else}
                        {playerEvent.label}
                    {/if}
                </button>
            {/each}
        </div>
    </div>

    {#if matchScore}
        <div class="match-score-label">
            <span class="match-score-team {getMatchScoreSideClass(matchScore.left.side)}">
                Team {matchScore.left.name} ({matchScore.left.score})
            </span>
            <span class="match-score-separator">vs</span>
            <span class="match-score-team {getMatchScoreSideClass(matchScore.right.side)}">
                Team {matchScore.right.name} ({matchScore.right.score})
            </span>
        </div>
    {/if}

    {#if bombStatus.bombText || bombStatus.defuseText}
        <div class="bomb-status">
            {#if bombStatus.bombText}
                <div class="bomb-label {bombStatus.bombClass}">{bombStatus.bombText}</div>
            {/if}
            {#if bombStatus.defuseText}
                <div class="bomb-label {bombStatus.defuseClass}">{bombStatus.defuseText}</div>
            {/if}
        </div>
    {/if}

    {#if toastMessage}
        <div class="copy-toast">{toastMessage}</div>
    {/if}

    <!-- Main canvas layers -->
    {#if viewMode === '2d'}
    <MapLayer 
        bind:mapMetadata={mapMetadata}
        bind:replayData={replayData}
        {mapVariant}
        onmapready={(ready) => isMapReady = ready}
    />
    {#if isMapReady}
    <DroppedEquipmentLayer
        bind:replayData={replayData}
        bind:mapMetadata={mapMetadata}
        bind:isPlaying={isPlaying}
        {showDroppedWeapons}
        {showDroppedUtility}
        {showDroppedC4}
    />
    <PlayerLayer 
        bind:replayData={replayData}
        bind:mapMetadata={mapMetadata}
        bind:isPlaying={isPlaying}
        {sightConeLength}
        {sightConeHalfAngle}
        {showSightCone}
        {sightConeForSelectedPlayer}
        {showLineOfSight}
        {lineOfSightLength}
        {lineOfSightWidth}
        {selectedPlayerSteamId}
        {showNoiseCircle}
        {noiseForSelectedPlayer}
        {enabledNoiseSources}
    />
    <NadeLayer
        bind:this={nadeLayer}
        bind:replayData={replayData}
        bind:mapMetadata={mapMetadata}
        bind:isPlaying={isPlaying}
    />
    <KillLayer 
        bind:replayData={replayData}
        bind:isPlaying={isPlaying}
        bind:mapMetadata={mapMetadata}
        feedLeftOffset={KILL_FEED_LEFT_OFFSET}
        onselectkillfeed={handleKillFeedSelect}
    />
    <DrawingLayer
        {isDrawingShortcutActive}
        {leftDrawingColor}
        {rightDrawingColor}
        strokeWidth={drawingStrokeWidth}
        clearSignal={drawingClearSignal}
        {drawingMode}
        fadeSeconds={drawingFadeSeconds}
    />
    {/if}
    {:else}
    <canvas class="three-d-viewport" aria-label="3D replay viewport" use:mount3DScene></canvas>
    {#if selectedPlayerSteamId !== null}
        <div class="three-d-crosshair" aria-hidden="true"><i></i><i></i></div>
    {/if}
    {#if map3DLoading}
        <div class="three-d-loading" role="status" aria-live="polite">
            <span class="three-d-spinner" aria-hidden="true"></span>
            <strong>{map3DLoadingText}</strong>
        </div>
    {:else if map3DError}
        <div class="three-d-map-error" role="alert">{map3DError}</div>
    {/if}
    {/if}

    <Controls
        {isPlaying}
        {playbackSpeed}
        {isLoading}
        speedOptions={SPEED_OPTIONS}
        hasLowerMapVariant={viewMode === '2d' && hasLowerMapVariant}
        {mapVariant}
        {viewMode}
        ontoggleplay={togglePlay}
        onsetspeed={setSpeed}
        onloaddemo={loadDemo}
        onsetmapvariant={setMapVariant}
        onsetviewmode={(mode) => void setViewMode(mode)}
        getshortcut={getShortcut}
        capturingActionId={shortcutCaptureActionId}
        onshortcutcapture={startShortcutCapture}
        onshortcutremove={deleteShortcut}
    />

    <TimeDisplay currentTick={displayTick} activeStart={activeStart} />

    <nav class="control-toolbar" aria-label="Replay controls">
        {#each visibleToolbarSections as section (section.key)}
            <button
                type="button"
                class="toolbar-item"
                class:active={activeToolbarSection === section.key}
                class:has-shortcut={Boolean(shortcutBindings[`section.${section.key}`])}
                aria-pressed={activeToolbarSection === section.key}
                aria-label={`${section.label} controls`}
                title={`${section.label} controls`}
                onclick={() => toggleToolbarSection(section.key)}
            >
                <span class="toolbar-icon" aria-hidden="true">
                    {#if section.key === 'camera'}
                        <svg viewBox="0 0 24 24"><path d="M4 7h11v10H4zM15 10l5-3v10l-5-3z"/><circle cx="9.5" cy="12" r="2.2"/></svg>
                    {:else if section.key === 'sight'}
                        <svg viewBox="0 0 24 24"><path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>
                    {:else if section.key === 'player'}
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M5.5 20c.6-4.2 2.8-6.3 6.5-6.3s5.9 2.1 6.5 6.3"/></svg>
                    {:else if section.key === 'noise'}
                        <svg viewBox="0 0 24 24"><path d="M5 14h3l4 4V6L8 10H5v4Z"/><path d="M15 9.5c1.4 1.4 1.4 3.6 0 5M18 7c2.8 2.8 2.8 7.2 0 10"/></svg>
                    {:else if section.key === 'timeline'}
                        <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="7" cy="17" r="1.5"/></svg>
                    {:else if section.key === 'equipment'}
                        <svg viewBox="0 0 24 24"><path d="M4 8h16v11H4zM9 8V5h6v3M4 13h16M10 13v2h4v-2"/></svg>
                    {:else}
                        <svg viewBox="0 0 24 24"><path d="m4 17 9-9 3 3-9 9H4v-3ZM14 7l2-2 3 3-2 2M4 4l4 1M4 4l1 4"/></svg>
                    {/if}
                </span>
                <span class="toolbar-label">{section.label}</span>
                {#if shortcutBindings[`section.${section.key}`]}
                    <span
                        class="toolbar-shortcut"
                        title={shortcutForDisplay(shortcutBindings[`section.${section.key}`])}
                    >
                        [{shortcutForDisplay(shortcutBindings[`section.${section.key}`]).replaceAll(' + ', '+')}]
                    </span>
                {/if}
            </button>
        {/each}
        <button
            type="button"
            class="toolbar-item donate"
            aria-label="Donate with PayPal"
            title="Donate with PayPal"
            onclick={openDonationPage}
        >
            <span class="toolbar-icon paypal-icon" aria-hidden="true">P</span>
            <span class="toolbar-label">Donate</span>
        </button>
    </nav>

    {#if activeToolbarSection}
        <aside class="control-panel" aria-label={`${TOOLBAR_SECTIONS.find(section => section.key === activeToolbarSection)?.label} controls`}>
            <header class="control-panel-header">
                <button
                    type="button"
                    class="panel-close"
                    aria-label="Close control panel"
                    title="Close control panel"
                    onclick={() => activeToolbarSection = null}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>
                </button>
                <div>
                    <div class="panel-eyebrow">Replay controls</div>
                    <h2>{TOOLBAR_SECTIONS.find(section => section.key === activeToolbarSection)?.label}</h2>
                </div>
                <ShortcutBinding
                    actionId={`section.${activeToolbarSection}`}
                    shortcut={getShortcut(`section.${activeToolbarSection}`)}
                    isCapturing={shortcutCaptureActionId === `section.${activeToolbarSection}`}
                    oncapture={startShortcutCapture}
                    onremove={deleteShortcut}
                />
            </header>

            <div class="control-panel-scroll">
                {#if activeToolbarSection === 'camera'}
                    <section class="control-section">
                        <div class="controls-heading">Movement keys</div>
                        <p class="panel-description">Click a key, then press its replacement. Escape cancels the change.</p>
                        <div class="camera-key-grid">
                            {#each CAMERA_MOVEMENT_CONTROLS as control (control.direction)}
                                <div class="camera-key-row">
                                    <span>{control.label}</span>
                                    <button
                                        type="button"
                                        class:capturing={cameraKeyCapture === control.direction}
                                        onclick={() => beginCameraKeyCapture(control.direction)}
                                        onkeydown={(event) => cameraKeyCapture === control.direction && captureCameraKey(event, control.direction)}
                                    >
                                        {cameraKeyCapture === control.direction ? 'Press key…' : keyCodeForDisplay(viewerSettings.cameraMovementKeys[control.direction])}
                                    </button>
                                </div>
                            {/each}
                        </div>
                    </section>
                    <section class="control-section">
                        <div class="controls-heading">Camera speed</div>
                        <div class="slider-control">
                            <div class="control-label-line"><span>Movement speed</span><output>{Math.round(viewerSettings.cameraMovementSpeed)}</output></div>
                            <div class="slider-input-line">
                                <ShortcutBinding actionId="camera.movement-speed.decrease" shortcut={getShortcut('camera.movement-speed.decrease')} isCapturing={shortcutCaptureActionId === 'camera.movement-speed.decrease'} emptyIcon="minus" oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                <input type="range" min="4" max="100" step="2" value={viewerSettings.cameraMovementSpeed} oninput={(event) => updateCameraSetting('cameraMovementSpeed', Number(event.currentTarget.value))} aria-label="3D camera movement speed" />
                                <ShortcutBinding actionId="camera.movement-speed.increase" shortcut={getShortcut('camera.movement-speed.increase')} isCapturing={shortcutCaptureActionId === 'camera.movement-speed.increase'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        </div>
                        <div class="slider-control">
                            <div class="control-label-line"><span>Zoom speed</span><output>{viewerSettings.cameraZoomSpeed.toFixed(1)}×</output></div>
                            <div class="slider-input-line">
                                <ShortcutBinding actionId="camera.zoom-speed.decrease" shortcut={getShortcut('camera.zoom-speed.decrease')} isCapturing={shortcutCaptureActionId === 'camera.zoom-speed.decrease'} emptyIcon="minus" oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                <input type="range" min="0.1" max="3" step="0.1" value={viewerSettings.cameraZoomSpeed} oninput={(event) => updateCameraSetting('cameraZoomSpeed', Number(event.currentTarget.value))} aria-label="3D camera mouse wheel zoom speed" />
                                <ShortcutBinding actionId="camera.zoom-speed.increase" shortcut={getShortcut('camera.zoom-speed.increase')} isCapturing={shortcutCaptureActionId === 'camera.zoom-speed.increase'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        </div>
                    </section>
                {:else if activeToolbarSection === 'sight'}
                    {#if viewMode === '2d'}
                    <section class="control-section">
                        <div class="controls-heading">Sight cone</div>
                        <div class="control-row">
                            <label class="checkbox-control"><input type="checkbox" bind:checked={showSightCone} /><span>Show Sight Cone</span></label>
                            <ShortcutBinding actionId="sight.show-cone" shortcut={getShortcut('sight.show-cone')} isCapturing={shortcutCaptureActionId === 'sight.show-cone'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                        <div class="control-row">
                            <label class="checkbox-control"><input type="checkbox" bind:checked={sightConeForSelectedPlayer} disabled={!showSightCone} /><span>Show for selected Player</span></label>
                            <ShortcutBinding actionId="sight.selected-only" shortcut={getShortcut('sight.selected-only')} isCapturing={shortcutCaptureActionId === 'sight.selected-only'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                        <div class="slider-control">
                            <div class="control-label-line"><span>Width</span><output>{sightConeHalfAngle.toFixed(2)}</output></div>
                            <div class="slider-input-line">
                                <ShortcutBinding actionId="sight.width.decrease" shortcut={getShortcut('sight.width.decrease')} isCapturing={shortcutCaptureActionId === 'sight.width.decrease'} emptyIcon="minus" oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                <input type="range" min="0.16" max="0.8" step="0.02" bind:value={sightConeHalfAngle} disabled={!showSightCone} aria-label="Sight cone width" />
                                <ShortcutBinding actionId="sight.width.increase" shortcut={getShortcut('sight.width.increase')} isCapturing={shortcutCaptureActionId === 'sight.width.increase'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        </div>
                        <div class="slider-control">
                            <div class="control-label-line"><span>Length</span><output>{Math.round(sightConeLength)}</output></div>
                            <div class="slider-input-line">
                                <ShortcutBinding actionId="sight.length.decrease" shortcut={getShortcut('sight.length.decrease')} isCapturing={shortcutCaptureActionId === 'sight.length.decrease'} emptyIcon="minus" oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                <input type="range" min="18" max="240" step="1" bind:value={sightConeLength} disabled={!showSightCone} aria-label="Sight cone length" />
                                <ShortcutBinding actionId="sight.length.increase" shortcut={getShortcut('sight.length.increase')} isCapturing={shortcutCaptureActionId === 'sight.length.increase'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        </div>
                    </section>
                    {/if}
                    <section class="control-section">
                        <div class="controls-heading">Line of sight</div>
                        <div class="control-row">
                            {#if viewMode === '3d'}
                                <label class="checkbox-control"><input type="checkbox" bind:checked={showLineOfSight3D} /><span>Show Line of Sight</span></label>
                            {:else}
                                <label class="checkbox-control"><input type="checkbox" bind:checked={showLineOfSight} /><span>Show Line of Sight</span></label>
                            {/if}
                            <ShortcutBinding actionId="sight.show-los" shortcut={getShortcut('sight.show-los')} isCapturing={shortcutCaptureActionId === 'sight.show-los'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                        <div class="slider-control">
                            <div class="control-label-line"><span>Width</span><output>{viewMode === '3d' ? Math.round(lineOfSightWidth3D) : lineOfSightWidth.toFixed(1)}</output></div>
                            <div class="slider-input-line">
                                <ShortcutBinding actionId="sight.los-width.decrease" shortcut={getShortcut('sight.los-width.decrease')} isCapturing={shortcutCaptureActionId === 'sight.los-width.decrease'} emptyIcon="minus" oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                {#if viewMode === '3d'}
                                    <input type="range" min="1" max="50" step="1" bind:value={lineOfSightWidth3D} aria-label="3D line of sight width" />
                                {:else}
                                    <input type="range" min="0.3" max="3" step="0.1" bind:value={lineOfSightWidth} aria-label="Line of sight width" />
                                {/if}
                                <ShortcutBinding actionId="sight.los-width.increase" shortcut={getShortcut('sight.los-width.increase')} isCapturing={shortcutCaptureActionId === 'sight.los-width.increase'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        </div>
                        <div class="slider-control">
                            <div class="control-label-line"><span>Length</span><output>{Math.round(viewMode === '3d' ? lineOfSightLength3D : lineOfSightLength)}</output></div>
                            <div class="slider-input-line">
                                <ShortcutBinding actionId="sight.los-length.decrease" shortcut={getShortcut('sight.los-length.decrease')} isCapturing={shortcutCaptureActionId === 'sight.los-length.decrease'} emptyIcon="minus" oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                {#if viewMode === '3d'}
                                    <input type="range" min="18" max="1100" step="1" bind:value={lineOfSightLength3D} aria-label="3D line of sight length" />
                                {:else}
                                    <input type="range" min="18" max="800" step="1" bind:value={lineOfSightLength} aria-label="Line of sight length" />
                                {/if}
                                <ShortcutBinding actionId="sight.los-length.increase" shortcut={getShortcut('sight.los-length.increase')} isCapturing={shortcutCaptureActionId === 'sight.los-length.increase'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        </div>
                        {#if viewMode === '3d'}
                            <div class="slider-control">
                                <div class="control-label-line"><span>Transparency</span><output>{Math.round(lineOfSightTransparency * 100)}%</output></div>
                                <div class="slider-input-line">
                                    <ShortcutBinding actionId="sight.los-opacity.decrease" shortcut={getShortcut('sight.los-opacity.decrease')} isCapturing={shortcutCaptureActionId === 'sight.los-opacity.decrease'} emptyIcon="minus" oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                    <input type="range" min="0" max="0.95" step="0.05" bind:value={lineOfSightTransparency} aria-label="Line of sight transparency" />
                                    <ShortcutBinding actionId="sight.los-opacity.increase" shortcut={getShortcut('sight.los-opacity.increase')} isCapturing={shortcutCaptureActionId === 'sight.los-opacity.increase'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                </div>
                            </div>
                        {/if}
                    </section>
                {:else if activeToolbarSection === 'player'}
                    <section class="control-section">
                        <div class="controls-heading">Player selection</div>
                        <p class="panel-description">Set how closely the radar follows a selected player.</p>
                        <div class="slider-control">
                            <div class="control-label-line"><span>Follow zoom</span><output>{Math.round(selectedPlayerZoomPercent)}%</output></div>
                            <div class="slider-input-line">
                                <ShortcutBinding actionId="player.zoom.decrease" shortcut={getShortcut('player.zoom.decrease')} isCapturing={shortcutCaptureActionId === 'player.zoom.decrease'} emptyIcon="minus" oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                <input type="range" min="100" max="500" step="25" bind:value={selectedPlayerZoomPercent} aria-label="Player selection zoom" />
                                <ShortcutBinding actionId="player.zoom.increase" shortcut={getShortcut('player.zoom.increase')} isCapturing={shortcutCaptureActionId === 'player.zoom.increase'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        </div>
                    </section>
                {:else if activeToolbarSection === 'noise'}
                    <section class="control-section">
                        <div class="controls-heading">Noise visibility</div>
                        <div class="control-row">
                            <label class="checkbox-control"><input type="checkbox" bind:checked={showNoiseCircle} /><span>Show Noise Circle</span></label>
                            <ShortcutBinding actionId="noise.show" shortcut={getShortcut('noise.show')} isCapturing={shortcutCaptureActionId === 'noise.show'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                        <div class="control-row">
                            <label class="checkbox-control"><input type="checkbox" bind:checked={noiseForSelectedPlayer} disabled={!showNoiseCircle} /><span>Noise for Selected Player</span></label>
                            <ShortcutBinding actionId="noise.selected-only" shortcut={getShortcut('noise.selected-only')} isCapturing={shortcutCaptureActionId === 'noise.selected-only'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                    </section>
                    <section class="control-section">
                        <div class="controls-heading">Sources</div>
                        {#each NOISE_SOURCE_OPTIONS as source (source.key)}
                            <div class="control-row">
                                <label class="checkbox-control">
                                    <input type="checkbox" checked={enabledNoiseSources[source.key]} disabled={!showNoiseCircle} onchange={(event) => setNoiseSourceEnabled(source.key, (event.currentTarget as HTMLInputElement).checked)} />
                                    <span>{source.label}</span>
                                </label>
                                <ShortcutBinding actionId={`noise.source.${source.key}`} shortcut={getShortcut(`noise.source.${source.key}`)} isCapturing={shortcutCaptureActionId === `noise.source.${source.key}`} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        {/each}
                    </section>
                {:else if activeToolbarSection === 'timeline'}
                    <section class="control-section">
                        <div class="controls-heading">Timeline events</div>
                        <div class="control-row">
                            <label class="checkbox-control"><input type="checkbox" bind:checked={showAllTimelineUtilities} /><span>Show all Utilities</span></label>
                            <ShortcutBinding actionId="timeline.show-all-utilities" shortcut={getShortcut('timeline.show-all-utilities')} isCapturing={shortcutCaptureActionId === 'timeline.show-all-utilities'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                        {#each TIMELINE_COMBAT_EVENT_OPTIONS as combatEvent (combatEvent.key)}
                            <div class="control-row">
                                <label class="checkbox-control"><input type="checkbox" checked={enabledTimelineCombatEvents[combatEvent.key]} onchange={(event) => setTimelineCombatEventEnabled(combatEvent.key, (event.currentTarget as HTMLInputElement).checked)} /><span>{combatEvent.label}</span></label>
                                <ShortcutBinding actionId={`timeline.combat.${combatEvent.key}`} shortcut={getShortcut(`timeline.combat.${combatEvent.key}`)} isCapturing={shortcutCaptureActionId === `timeline.combat.${combatEvent.key}`} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        {/each}
                        {#each TIMELINE_UTILITY_OPTIONS as utility (utility.key)}
                            <div class="control-row">
                                <label class="checkbox-control"><input type="checkbox" checked={enabledTimelineUtilities[utility.key]} onchange={(event) => setTimelineUtilityEnabled(utility.key, (event.currentTarget as HTMLInputElement).checked)} /><span>{utility.label}</span></label>
                                <ShortcutBinding actionId={`timeline.utility.${utility.key}`} shortcut={getShortcut(`timeline.utility.${utility.key}`)} isCapturing={shortcutCaptureActionId === `timeline.utility.${utility.key}`} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        {/each}
                    </section>
                {:else if activeToolbarSection === 'equipment'}
                    <section class="control-section">
                        <div class="controls-heading">Dropped equipment</div>
                        <div class="control-row">
                            <label class="checkbox-control"><input type="checkbox" bind:checked={showDroppedWeapons} /><span>Show Dropped Weapons</span></label>
                            <ShortcutBinding actionId="equipment.weapons" shortcut={getShortcut('equipment.weapons')} isCapturing={shortcutCaptureActionId === 'equipment.weapons'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                        <div class="control-row">
                            <label class="checkbox-control"><input type="checkbox" bind:checked={showDroppedUtility} /><span>Show Dropped Utility</span></label>
                            <ShortcutBinding actionId="equipment.utility" shortcut={getShortcut('equipment.utility')} isCapturing={shortcutCaptureActionId === 'equipment.utility'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                        <div class="control-row">
                            <label class="checkbox-control"><input type="checkbox" bind:checked={showDroppedC4} /><span>Show Dropped C4</span></label>
                            <ShortcutBinding actionId="equipment.c4" shortcut={getShortcut('equipment.c4')} isCapturing={shortcutCaptureActionId === 'equipment.c4'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                    </section>
                {:else if activeToolbarSection === 'drawing'}
                    <section class="control-section">
                        <div class="controls-heading">Drawing setup</div>
                        <p class="drawing-hint">Hold the keyboard Drawing Setup shortcut, then drag with the left or right mouse button.</p>
                        <div class="control-row drawing-shortcut-row">
                            <span class="shortcut-control-label">Hold to draw</span>
                            <ShortcutBinding actionId="drawing.setup" shortcut={getShortcut('drawing.setup')} isCapturing={shortcutCaptureActionId === 'drawing.setup'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                        <label class="drawing-color-control"><span>Primary Color</span><input type="color" bind:value={leftDrawingColor} /></label>
                        <label class="drawing-color-control"><span>Secondary Color</span><input type="color" bind:value={rightDrawingColor} /></label>
                        <div class="slider-control">
                            <div class="control-label-line"><span>Stroke width</span><output>{Math.round(drawingStrokeWidth)}</output></div>
                            <div class="slider-input-line">
                                <ShortcutBinding actionId="drawing.stroke.decrease" shortcut={getShortcut('drawing.stroke.decrease')} isCapturing={shortcutCaptureActionId === 'drawing.stroke.decrease'} emptyIcon="minus" oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                <input type="range" min="1" max="10" step="1" bind:value={drawingStrokeWidth} aria-label="Drawing stroke width" />
                                <ShortcutBinding actionId="drawing.stroke.increase" shortcut={getShortcut('drawing.stroke.increase')} isCapturing={shortcutCaptureActionId === 'drawing.stroke.increase'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                            </div>
                        </div>
                    </section>
                    <section class="control-section">
                        <div class="controls-heading">Persistence</div>
                        <div class="button-control-row">
                            <button type="button" class={`drawing-mode-button${drawingMode === 'permanent' ? ' selected' : ''}`} onclick={() => drawingMode = 'permanent'}>Permanent</button>
                            <ShortcutBinding actionId="drawing.mode.permanent" shortcut={getShortcut('drawing.mode.permanent')} isCapturing={shortcutCaptureActionId === 'drawing.mode.permanent'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                        <div class="button-control-row">
                            <button type="button" class={`drawing-mode-button${drawingMode === 'fade' ? ' selected' : ''}`} onclick={() => drawingMode = 'fade'}>Fade</button>
                            <ShortcutBinding actionId="drawing.mode.fade" shortcut={getShortcut('drawing.mode.fade')} isCapturing={shortcutCaptureActionId === 'drawing.mode.fade'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                        {#if drawingMode === 'fade'}
                            <div class="slider-control">
                                <div class="control-label-line"><span>Fade time</span><output>{Math.round(drawingFadeSeconds)}s</output></div>
                                <div class="slider-input-line">
                                    <ShortcutBinding actionId="drawing.fade.decrease" shortcut={getShortcut('drawing.fade.decrease')} isCapturing={shortcutCaptureActionId === 'drawing.fade.decrease'} emptyIcon="minus" oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                    <input type="range" min="1" max="6" step="1" bind:value={drawingFadeSeconds} aria-label="Drawing fade time" />
                                    <ShortcutBinding actionId="drawing.fade.increase" shortcut={getShortcut('drawing.fade.increase')} isCapturing={shortcutCaptureActionId === 'drawing.fade.increase'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                                </div>
                            </div>
                        {/if}
                        <div class="button-control-row">
                            <button type="button" class="panel-button" onclick={clearAllDrawings}>Clear all Drawings</button>
                            <ShortcutBinding actionId="drawing.clear" shortcut={getShortcut('drawing.clear')} isCapturing={shortcutCaptureActionId === 'drawing.clear'} oncapture={startShortcutCapture} onremove={deleteShortcut} />
                        </div>
                    </section>
                {/if}
            </div>
        </aside>
    {/if}

    <div class="player-roster">
        <div class="roster-columns">
            <div class="roster-column">
                <div class="roster-title">CT ({ctAliveCount}/{ctRoster.length})</div>
                {#each ctRoster as entry, slotIndex (entry.player.steamId.toString())}
                    <div class="roster-player-row" style="--player-color: {entry.color};">
                        <button
                            class="roster-player"
                            class:dead={!entry.isAlive}
                            class:selected={isSelectedPlayer(entry.player.steamId)}
                            title={entry.player.name}
                            onclick={() => handleRosterPlayerClick(entry)}
                        >
                            {entry.player.name}
                        </button>
                        <ShortcutBinding
                            actionId={`player-slot.ct.${slotIndex}`}
                            shortcut={getShortcut(`player-slot.ct.${slotIndex}`)}
                            isCapturing={shortcutCaptureActionId === `player-slot.ct.${slotIndex}`}
                            oncapture={startShortcutCapture}
                            onremove={deleteShortcut}
                        />
                    </div>
                {/each}
            </div>
            <div class="roster-column">
                <div class="roster-title">T ({tAliveCount}/{tRoster.length})</div>
                {#each tRoster as entry, slotIndex (entry.player.steamId.toString())}
                    <div class="roster-player-row" style="--player-color: {entry.color};">
                        <button
                            class="roster-player"
                            class:dead={!entry.isAlive}
                            class:selected={isSelectedPlayer(entry.player.steamId)}
                            title={entry.player.name}
                            onclick={() => handleRosterPlayerClick(entry)}
                        >
                            {entry.player.name}
                        </button>
                        <ShortcutBinding
                            actionId={`player-slot.t.${slotIndex}`}
                            shortcut={getShortcut(`player-slot.t.${slotIndex}`)}
                            isCapturing={shortcutCaptureActionId === `player-slot.t.${slotIndex}`}
                            oncapture={startShortcutCapture}
                            onremove={deleteShortcut}
                        />
                    </div>
                {/each}
            </div>
        </div>
    </div>

    <RoundNav {replayData} currentTick={displayTick} onseekround={seekToRound} />
</div>
{:else}
<div class="empty-state">
    <div class="empty-state-content">
        <h2 class="empty-state-title">CS2 Replay Viewer</h2>
        <p class="empty-state-text">No replay loaded. Select a .dem file to begin.</p>
        <div class="empty-state-actions">
            <button class="load-button" onclick={loadDemo} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Load Demo File'}
            </button>
            <button
                type="button"
                class="donation-button"
                aria-label="Donate to CS2 Replay Viewer with PayPal"
                onclick={openDonationPage}
            >
                <span class="donation-button-icon" aria-hidden="true">P</span>
                <span>Donate with PayPal</span>
            </button>
        </div>
    </div>
</div>
{/if}
