<script lang="ts">
import { onMount, tick as flushDom } from 'svelte';
import { browser } from '$app/environment';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
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
import KillLayer from '$lib/components/KillLayer.svelte';
import DrawingLayer from '$lib/components/DrawingLayer.svelte';
import Controls from '$lib/components/Controls.svelte';
import TimeDisplay from '$lib/components/TimeDisplay.svelte';
import RoundNav from '$lib/components/RoundNav.svelte';
import { DEFAULT_RADAR_MAP, getRadarInfo } from '$lib/maps/radar-info';
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
const DEFAULT_SELECTED_PLAYER_ZOOM_PERCENT = 250;
const MAX_MOUSE_VIEWPORT_ZOOM_SCALE = 5;
const MAP_PAN_BOUNDARY_PADDING = 0.1;
const PLAYER_DOT_CLICK_RADIUS = 12;
const DEFAULT_DRAWING_COLOR = '#22c55e';
const DEFAULT_DRAWING_STROKE_WIDTH = 4;
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

const NOISE_SOURCE_OPTIONS = [
    { key: 'running', label: 'Running Noise' },
    { key: 'jump', label: 'Jump Noise' },
    { key: 'shooting', label: 'Shooting Noise' },
    { key: 'falling', label: 'Falling Noise' },
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
type NoiseSourceKey = typeof NOISE_SOURCE_OPTIONS[number]['key'];
type TimelineUtilityKey = typeof TIMELINE_UTILITY_OPTIONS[number]['key'];
type TimelineCombatEventKey = typeof TIMELINE_COMBAT_EVENT_OPTIONS[number]['key'];

let activeStart: number = 0;
let sightConeLength = DEFAULT_SIGHT_CONE_LENGTH;
let sightConeHalfAngle = DEFAULT_SIGHT_CONE_HALF_ANGLE;
let showSightCone = true;
let sightConeForSelectedPlayer = false;
let showLineOfSight = false;
let lineOfSightLength = DEFAULT_LINE_OF_SIGHT_LENGTH;
let lineOfSightWidth = DEFAULT_LINE_OF_SIGHT_WIDTH;
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
    hasMoved: boolean;
} | null = null;
let ignoreNextCanvasClick = false;
let drawingColor = DEFAULT_DRAWING_COLOR;
let drawingStrokeWidth = DEFAULT_DRAWING_STROKE_WIDTH;
let isShiftDrawingActive = false;
let drawingClearSignal = 0;
let selectedPlayerSteamId: bigint | null = null;
let showNoiseCircle = false;
let noiseForSelectedPlayer = false;
let enabledNoiseSources: Record<NoiseSourceKey, boolean> = {
    running: true,
    jump: true,
    shooting: true,
    falling: true,
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
let bombStatus: BombStatus = { bombText: '', bombClass: '', defuseText: '', defuseClass: '' };
let playerFrameTrails = new Map<string, PlayerFrame[]>();
let playerFrameLookupIndices = new Map<string, number>();
let timelineNadesByThrower = new Map<string, NadeEvent[]>();
let timelineTrajectoryNadesByThrower = new Map<string, NadeEvent[]>();
let timelineTrajectoryNades: NadeEvent[] = [];
let timelineNadeMatchCache = new WeakMap<NadeEvent, boolean>();

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
        mapMetadata = createMapMetadataFromRadarInfo();
    }

    selectedPlayerSteamId = null;
    isShiftDrawingActive = false;
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
    replayData = data;
    mapMetadata = fillMapMetadata(data.map, data.header?.mapName);
    selectedPlayerSteamId = null;
    timelineEventsCache.clear();
    playablePlayers = getPlayablePlayers();
    rebuildPlayerFrameIndex(playablePlayers);
    rebuildTimelineNadeIndex();
    warmTimelineEventsCache();
    isShiftDrawingActive = false;
    mapVariant = 'default';
    timelineEvents = [];
    timelineEventsKey = '';
    timelineHeight = TIMELINE_MIN_HEIGHT;
    matchScore = null;
    bombStatus = emptyBombStatus();
    setPlaying(false);
    setTick(data.rounds[0] ? getRoundActiveStart(data.rounds[0]) : 0);
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

function selectPlayer(steamId: bigint): void {
    if (selectedPlayerSteamId === steamId) {
        const retainedTransform = getReplayViewportTransform();
        selectedPlayerSteamId = null;
        mouseViewportZoomScale = Math.max(1, retainedTransform.scale);
        mouseViewportTranslateX = retainedTransform.translateX;
        mouseViewportTranslateY = retainedTransform.translateY;
        mouseViewportDrag = null;
        ignoreNextCanvasClick = false;
        preserveUnconstrainedViewport = true;
    } else {
        selectedPlayerSteamId = steamId;
        resetMouseViewportZoom();
    }
    timelineEventsKey = '';
    updateReplayViewportTransform();
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

    if (mouseViewportZoomScale <= 1 || preserveUnconstrainedViewport || !replayContainer) return transform;

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
    const horizontalPadding = scaledMapWidth * MAP_PAN_BOUNDARY_PADDING;
    const verticalPadding = scaledMapHeight * MAP_PAN_BOUNDARY_PADDING;

    const translateX = scaledMapWidth <= viewport.width
        ? viewport.width / 2 - (mapLeft + displayedMapWidth / 2) * transform.scale
        : Math.max(
            viewport.width - (mapLeft + displayedMapWidth) * transform.scale - horizontalPadding,
            Math.min(-mapLeft * transform.scale + horizontalPadding, transform.translateX)
        );
    const translateY = scaledMapHeight <= viewport.height
        ? viewport.height / 2 - (mapTop + displayedMapHeight / 2) * transform.scale
        : Math.max(
            viewport.height - (mapTop + displayedMapHeight) * transform.scale - verticalPadding,
            Math.min(-mapTop * transform.scale + verticalPadding, transform.translateY)
        );

    return { ...transform, translateX, translateY };
}

function constrainMouseViewportTranslation(): void {
    if (!replayContainer || mouseViewportZoomScale <= 1) return;

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
    if (!(event.target instanceof HTMLCanvasElement) || !replayContainer) return;

    event.preventDefault();

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
    if (event.button === 0) {
        ignoreNextCanvasClick = false;
    }

    if (
        isShiftDrawingActive ||
        event.shiftKey ||
        event.button !== 0 ||
        mouseViewportZoomScale <= 1 ||
        !(event.target instanceof HTMLCanvasElement)
    ) {
        return;
    }

    mouseViewportDrag = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startTranslateX: mouseViewportTranslateX,
        startTranslateY: mouseViewportTranslateY,
        hasMoved: false,
    };
    event.target.setPointerCapture(event.pointerId);
}

function handleViewportPointerMove(event: PointerEvent): void {
    if (!mouseViewportDrag || event.pointerId !== mouseViewportDrag.pointerId) return;

    const deltaX = event.clientX - mouseViewportDrag.startClientX;
    const deltaY = event.clientY - mouseViewportDrag.startClientY;
    if (!mouseViewportDrag.hasMoved && Math.hypot(deltaX, deltaY) < 2) return;

    mouseViewportDrag.hasMoved = true;
    preserveUnconstrainedViewport = false;
    mouseViewportTranslateX = mouseViewportDrag.startTranslateX + deltaX;
    mouseViewportTranslateY = mouseViewportDrag.startTranslateY + deltaY;
    constrainMouseViewportTranslation();
    updateReplayViewportTransform();
}

function finishViewportPointerDrag(event: PointerEvent): void {
    if (!mouseViewportDrag || event.pointerId !== mouseViewportDrag.pointerId) return;

    ignoreNextCanvasClick = mouseViewportDrag.hasMoved;
    if (event.target instanceof HTMLCanvasElement && event.target.hasPointerCapture(event.pointerId)) {
        event.target.releasePointerCapture(event.pointerId);
    }
    mouseViewportDrag = null;
}

function handleReplayCanvasClick(event: MouseEvent): void {
    if (ignoreNextCanvasClick) {
        ignoreNextCanvasClick = false;
        return;
    }
    if (isShiftDrawingActive || event.shiftKey || !(event.target instanceof HTMLCanvasElement) || !replayContainer) return;

    const rect = replayContainer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const transform = getReplayViewportTransform();
    const clickX = (event.clientX - rect.left - transform.translateX) / transform.scale;
    const clickY = (event.clientY - rect.top - transform.translateY) / transform.scale;
    const playbackTick = getPlaybackTick();
    let closestSteamId: bigint | null = null;
    let closestDistanceSquared = PLAYER_DOT_CLICK_RADIUS * PLAYER_DOT_CLICK_RADIUS;

    for (const player of playablePlayers) {
        const frame = getPlayerFrameAtTick(player.steamId, playbackTick);
        if (!frame) continue;

        const playerPosition = worldToCanvas(frame.x, frame.y, mapMetadata, {
            width: rect.width,
            height: rect.height,
        });
        const distanceX = clickX - playerPosition.x;
        const distanceY = clickY - playerPosition.y;
        const distanceSquared = distanceX * distanceX + distanceY * distanceY;

        if (distanceSquared <= closestDistanceSquared) {
            closestSteamId = player.steamId;
            closestDistanceSquared = distanceSquared;
        }
    }

    if (closestSteamId !== null) {
        selectPlayer(closestSteamId);
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
    void selectedPlayerSteamId, playablePlayers;
    if (
        selectedPlayerSteamId !== null &&
        !playablePlayers.some(player => player.steamId === selectedPlayerSteamId)
    ) {
        selectedPlayerSteamId = null;
        timelineEventsKey = '';
        updateReplayViewportTransform();
    }
}

$: {
    void replayData, displayTick, playablePlayers;
    const round = getCurrentRoundData(displayTick) ?? getPlaybackStartRound(displayTick);
    const rosterEntries = buildRosterEntries(round, displayTick);
    ctRoster = rosterEntries.filter(entry => entry.side === TEAM_CT);
    tRoster = rosterEntries.filter(entry => entry.side === TEAM_T);
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

function seekToRound(round: RoundData) {
    if (round) {
        setTick(getRoundActiveStart(round));
    }
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Shift') {
        isShiftDrawingActive = true;
        return;
    }
    if (e.key === ' ') {
        e.preventDefault();
        setPlaying(!isPlaying);
    }
}

function handleKeyup(e: KeyboardEvent) {
    if (e.key === 'Shift') {
        isShiftDrawingActive = false;
    }
}

function handleWindowBlur() {
    isShiftDrawingActive = false;
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
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('keyup', handleKeyup);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('resize', handleViewportResize);
    updateReplayViewportTransform();
    return () => {
        window.removeEventListener('keydown', handleKeydown);
        window.removeEventListener('keyup', handleKeyup);
        window.removeEventListener('blur', handleWindowBlur);
        window.removeEventListener('resize', handleViewportResize);
        if (rafId) cancelAnimationFrame(rafId);
        if (toastTimeout) clearTimeout(toastTimeout);
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

.sight-controls {
    position: absolute;
    top: calc(var(--timeline-height, 86px) + 48px);
    bottom: 80px;
    left: 20px;
    width: 252px;
    background: rgba(26, 26, 36, 0.86);
    border: 1px solid #2a2a40;
    border-radius: 6px;
    padding: 10px 12px;
    z-index: 100;
    overflow-y: auto;
}

.control-section + .control-section {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.controls-heading {
    margin-bottom: 8px;
    color: #e2e8f0;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    line-height: 1.2;
    text-transform: uppercase;
}

.sight-control {
    display: grid;
    grid-template-columns: 66px 1fr 42px;
    align-items: center;
    gap: 8px;
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 600;
}

.sight-control + .sight-control {
    margin-top: 8px;
}

.sight-control input {
    width: 100%;
    accent-color: #60a5fa;
}

.sight-control input:disabled {
    opacity: 0.5;
}

.sight-control-value {
    color: #94a3b8;
    font-family: 'JetBrains Mono', monospace;
    text-align: right;
}

.drawing-control,
.drawing-color-control {
    display: grid;
    grid-template-columns: 84px 1fr 34px;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 600;
}

.drawing-control input[type='range'] {
    width: 100%;
    accent-color: #60a5fa;
}

.drawing-color-control {
    grid-template-columns: 84px 44px 1fr;
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

.drawing-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    margin-top: 10px;
}

.drawing-hint {
    margin: 0 0 8px;
    color: #94a3b8;
    font-size: 11px;
    line-height: 1.35;
}

.panel-button {
    width: 100%;
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
    align-items: center;
    gap: 8px;
    margin-top: 8px;
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

.player-roster {
    position: absolute;
    top: calc(var(--timeline-height, 86px) + 10px);
    right: 20px;
    width: 316px;
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
    width: 100%;
    height: 24px;
    margin-bottom: 4px;
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

</style>

{#if replayData}
<div
    class="replay-container"
    bind:this={replayContainer}
    style:--timeline-height={`${timelineHeight}px`}
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
    <MapLayer 
        bind:mapMetadata={mapMetadata}
        bind:replayData={replayData}
        {mapVariant}
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
        {isShiftDrawingActive}
        {drawingColor}
        strokeWidth={drawingStrokeWidth}
        clearSignal={drawingClearSignal}
    />

    <Controls
        {isPlaying}
        {playbackSpeed}
        {isLoading}
        speedOptions={SPEED_OPTIONS}
        {hasLowerMapVariant}
        {mapVariant}
        ontoggleplay={togglePlay}
        onsetspeed={setSpeed}
        onloaddemo={loadDemo}
        onsetmapvariant={setMapVariant}
    />

    <TimeDisplay currentTick={displayTick} activeStart={activeStart} />

    <div class="sight-controls">
        <section class="control-section">
            <div class="controls-heading">Sight</div>
            <label class="checkbox-control">
                <input type="checkbox" bind:checked={showSightCone} />
                <span>Show Sight Cone</span>
            </label>
            <label class="checkbox-control">
                <input
                    type="checkbox"
                    bind:checked={sightConeForSelectedPlayer}
                    disabled={!showSightCone}
                />
                <span>Show for selected Player</span>
            </label>
            <label class="sight-control">
                <span>Width</span>
                <input
                    type="range"
                    min="0.16"
                    max="0.8"
                    step="0.02"
                    bind:value={sightConeHalfAngle}
                    disabled={!showSightCone}
                />
                <span class="sight-control-value">{sightConeHalfAngle.toFixed(2)}</span>
            </label>
            <label class="sight-control">
                <span>Length</span>
                <input
                    type="range"
                    min="18"
                    max="240"
                    step="1"
                    bind:value={sightConeLength}
                    disabled={!showSightCone}
                />
                <span class="sight-control-value">{Math.round(sightConeLength)}</span>
            </label>
            <label class="checkbox-control">
                <input type="checkbox" bind:checked={showLineOfSight} />
                <span>Show Line of Sight</span>
            </label>
            <label class="sight-control">
                <span>LOS Width</span>
                <input
                    type="range"
                    min="0.3"
                    max="3.0"
                    step="0.1"
                    bind:value={lineOfSightWidth}
                />
                <span class="sight-control-value">{lineOfSightWidth.toFixed(1)}</span>
            </label>
            <label class="sight-control">
                <span>LOS Len</span>
                <input
                    type="range"
                    min="18"
                    max="800"
                    step="1"
                    bind:value={lineOfSightLength}
                />
                <span class="sight-control-value">{Math.round(lineOfSightLength)}</span>
            </label>
        </section>
        <section class="control-section">
            <div class="controls-heading">Player Selection</div>
            <label class="sight-control">
                <span>Zoom</span>
                <input
                    type="range"
                    min="100"
                    max="500"
                    step="25"
                    bind:value={selectedPlayerZoomPercent}
                />
                <span class="sight-control-value">{Math.round(selectedPlayerZoomPercent)}%</span>
            </label>
        </section>
        <section class="control-section">
            <div class="controls-heading">Noise</div>
            <label class="checkbox-control">
                <input type="checkbox" bind:checked={showNoiseCircle} />
                <span>Show Noice Circle</span>
            </label>
            <label class="checkbox-control">
                <input
                    type="checkbox"
                    bind:checked={noiseForSelectedPlayer}
                    disabled={!showNoiseCircle}
                />
                <span>Noise for Selected Player</span>
            </label>
            {#each NOISE_SOURCE_OPTIONS as source (source.key)}
                <label class="checkbox-control">
                    <input
                        type="checkbox"
                        checked={enabledNoiseSources[source.key]}
                        disabled={!showNoiseCircle}
                        onchange={(event) => setNoiseSourceEnabled(source.key, (event.currentTarget as HTMLInputElement).checked)}
                    />
                    <span>{source.label}</span>
                </label>
            {/each}
        </section>
        <section class="control-section">
            <div class="controls-heading">Timeline</div>
            <label class="checkbox-control">
                <input type="checkbox" bind:checked={showAllTimelineUtilities} />
                <span>Show all Utilities</span>
            </label>
            {#each TIMELINE_COMBAT_EVENT_OPTIONS as combatEvent (combatEvent.key)}
                <label class="checkbox-control">
                    <input
                        type="checkbox"
                        checked={enabledTimelineCombatEvents[combatEvent.key]}
                        onchange={(event) => setTimelineCombatEventEnabled(combatEvent.key, (event.currentTarget as HTMLInputElement).checked)}
                    />
                    <span>{combatEvent.label}</span>
                </label>
            {/each}
            {#each TIMELINE_UTILITY_OPTIONS as utility (utility.key)}
                <label class="checkbox-control">
                    <input
                        type="checkbox"
                        checked={enabledTimelineUtilities[utility.key]}
                        onchange={(event) => setTimelineUtilityEnabled(utility.key, (event.currentTarget as HTMLInputElement).checked)}
                    />
                    <span>{utility.label}</span>
                </label>
            {/each}
        </section>
        <section class="control-section">
            <div class="controls-heading">Drawing</div>
            <p class="drawing-hint">Hold Shift and drag with the left mouse button to draw.</p>
            <label class="drawing-color-control">
                <span>Color</span>
                <input type="color" bind:value={drawingColor} />
            </label>
            <label class="drawing-control">
                <span>Stroke Width</span>
                <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    bind:value={drawingStrokeWidth}
                />
                <span class="sight-control-value">{Math.round(drawingStrokeWidth)}</span>
            </label>
            <div class="drawing-actions">
                <button type="button" class="panel-button" onclick={clearAllDrawings}>
                    Clear all Drawings
                </button>
            </div>
        </section>
    </div>

    <div class="player-roster">
        <div class="roster-columns">
            <div class="roster-column">
                <div class="roster-title">CT ({ctAliveCount}/{ctRoster.length})</div>
                {#each ctRoster as entry (entry.player.steamId.toString())}
                    <button
                        class="roster-player"
                        class:dead={!entry.isAlive}
                        class:selected={isSelectedPlayer(entry.player.steamId)}
                        style="--player-color: {entry.color};"
                        title={entry.player.name}
                        onclick={() => selectPlayer(entry.player.steamId)}
                    >
                        {entry.player.name}
                    </button>
                {/each}
            </div>
            <div class="roster-column">
                <div class="roster-title">T ({tAliveCount}/{tRoster.length})</div>
                {#each tRoster as entry (entry.player.steamId.toString())}
                    <button
                        class="roster-player"
                        class:dead={!entry.isAlive}
                        class:selected={isSelectedPlayer(entry.player.steamId)}
                        style="--player-color: {entry.color};"
                        title={entry.player.name}
                        onclick={() => selectPlayer(entry.player.steamId)}
                    >
                        {entry.player.name}
                    </button>
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
        <button class="load-button" onclick={loadDemo} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Load Demo File'}
        </button>
    </div>
</div>
{/if}

<svelte:window
    onclick={handleReplayCanvasClick}
    onwheel={handleViewportWheel}
    onpointerdown={handleViewportPointerDown}
    onpointermove={handleViewportPointerMove}
    onpointerup={finishViewportPointerDrag}
    onpointercancel={finishViewportPointerDrag}
/>
