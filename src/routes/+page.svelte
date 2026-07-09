<script lang="ts">
import { onMount } from 'svelte';
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
import { worldToCanvas } from '$lib/canvas/transforms';
import MapLayer from '$lib/components/MapLayer.svelte';
import PlayerLayer from '$lib/components/PlayerLayer.svelte';
import NadeLayer from '$lib/components/NadeLayer.svelte';
import KillLayer from '$lib/components/KillLayer.svelte';
import Controls from '$lib/components/Controls.svelte';
import TimeDisplay from '$lib/components/TimeDisplay.svelte';
import RoundNav from '$lib/components/RoundNav.svelte';
import { DEFAULT_RADAR_MAP, getRadarInfo } from '$lib/maps/radar-info';
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
const DEFAULT_SIGHT_CONE_LENGTH = 34;
const DEFAULT_SIGHT_CONE_HALF_ANGLE = 0.32;
const EVENT_SEEK_LEAD_SECONDS = 2;
const DEFAULT_LINE_OF_SIGHT_LENGTH = 160;
const DEFAULT_SELECTED_PLAYER_ZOOM_PERCENT = 250;
const TOAST_DURATION_MS = 2600;
const DEFAULT_BOMB_TIME_SECONDS = 40;
const DEFUSE_SECONDS_WITH_KIT = 5;
const DEFUSE_SECONDS_WITHOUT_KIT = 10;
const EVENT_STACK_WINDOW_TICKS = 128;
const NADE_MATCH_DISTANCE_UNITS = 240;
const NADE_MATCH_TICK_WINDOW = 768;
const SMOKE_MATCH_TICK_WINDOW = 1536;

let activeStart: number = 0;
let sightConeLength = DEFAULT_SIGHT_CONE_LENGTH;
let sightConeHalfAngle = DEFAULT_SIGHT_CONE_HALF_ANGLE;
let showLineOfSight = false;
let lineOfSightLength = DEFAULT_LINE_OF_SIGHT_LENGTH;
let zoomSelectedPlayer = false;
let selectedPlayerZoomPercent = DEFAULT_SELECTED_PLAYER_ZOOM_PERCENT;
let selectedPlayerSteamId: bigint | null = null;
let playablePlayers: PlayerInfo[] = [];
let ctRoster: RosterEntry[] = [];
let tRoster: RosterEntry[] = [];
let ctAliveCount = 0;
let tAliveCount = 0;
let timelineEvents: PlayerTimelineEvent[] = [];
let timelineEventsKey = '';
let toastMessage = '';
let toastTimeout: ReturnType<typeof setTimeout> | null = null;
let bombStatus: BombStatus = { bombText: '', bombClass: '', defuseText: '', defuseClass: '' };
let playerFrameTrails = new Map<string, PlayerFrame[]>();
let playerFrameLookupIndices = new Map<string, number>();

type RosterEntry = {
    player: PlayerInfo;
    side: number;
    isAlive: boolean;
    color: string;
};

type PlayerEventType = 'kill' | 'death' | 'smoke' | 'flashbang' | 'molotov' | 'hegrenade' | 'decoy' | 'bomb_planted' | 'bomb_exploded' | 'bomb_defused';

type BasePlayerTimelineEvent = {
    tick: number;
    type: PlayerEventType;
    label: string;
    color: string;
    title: string;
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

async function loadDemo() {
    if (!browser) return;
    isLoading = true;
    try {
        const demPath: string | null = await invoke('open_file_dialog');
        if (!demPath) { isLoading = false; return; }
        const pbPath: string = await invoke('parse_demo', { path: demPath });
        const bytes = await readFile(pbPath);
        const data = fromBinary(ReplayDataSchema, bytes);
        replayData = data;
        mapMetadata = fillMapMetadata(data.map, data.header?.mapName);
        selectedPlayerSteamId = null;
        timelineEvents = [];
        timelineEventsKey = '';
        bombStatus = emptyBombStatus();
        setPlaying(false);
        setTick(0);
    } catch (e: any) {
        console.error('Failed to load demo:', e);
    } finally {
        isLoading = false;
    }
}

function getCurrentRoundData(tick: number = Math.floor(getPlaybackTick())): RoundData | null {
    if (!replayData?.rounds) return null;
    for (const round of replayData.rounds) {
        if (tick >= round.startTick && tick <= round.endTick) {
            return round;
        }
    }
    return null;
}

function getPlaybackStartRound(tick: number = Math.floor(getPlaybackTick())): RoundData | null {
    if (!replayData?.rounds) return null;
    for (const round of replayData.rounds) {
        if (tick <= round.endTick) {
            return round;
        }
    }
    return null;
}

function getRoundActiveStart(round: RoundData): number {
    if (round.freezetimeEndTick > 0) return round.freezetimeEndTick;
    const estimatedFreezetimeTicks = 960;
    return round.startTick + estimatedFreezetimeTicks;
}

function getRoundForTick(tick: number): RoundData | null {
    if (!replayData?.rounds) return null;
    for (const round of replayData.rounds) {
        if (tick >= round.startTick && tick <= round.endTick) {
            return round;
        }
    }
    return null;
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
        return { type: 'smoke', label: 'S', color: '#9ca3af' };
    }
    if (nadeType === 'flashbang') {
        return { type: 'flashbang', label: 'F', color: '#fde047' };
    }
    if (nadeType === 'molotov' || nadeType === 'incendiary') {
        return { type: 'molotov', label: 'M', color: '#dc2626' };
    }
    if (nadeType === 'hegrenade') {
        return { type: 'hegrenade', label: 'HE', color: '#f97316' };
    }
    if (nadeType === 'decoy') {
        return { type: 'decoy', label: 'DC', color: '#60a5fa' };
    }
    return null;
}

function getNadeTypeName(nadeType: string): string {
    if (nadeType === 'smoke') return 'Smoke';
    if (nadeType === 'flashbang') return 'Flashbang';
    if (nadeType === 'molotov' || nadeType === 'incendiary') return 'Molotov';
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

function hasNadeTrajectory(nade: NadeEvent): boolean {
    return (nade.trajectory?.length ?? 0) >= 2;
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
    return nadeType === 'smoke' ? SMOKE_MATCH_TICK_WINDOW : NADE_MATCH_TICK_WINDOW;
}

function hasMatchingTrajectoryNade(eventOnlyNade: NadeEvent, steamId: bigint): boolean {
    if (!replayData?.nades) return false;
    const eventTick = getNadeDetonationTick(eventOnlyNade);
    const eventEnd = { x: eventOnlyNade.endX, y: eventOnlyNade.endY };

    return replayData.nades.some(candidate => {
        if (candidate === eventOnlyNade || candidate.throwerSteamId !== steamId || !hasNadeTrajectory(candidate)) {
            return false;
        }
        if (!areMatchingNadeTypes(candidate.nadeType, eventOnlyNade.nadeType)) return false;
        if (Math.abs(getNadeDetonationTick(candidate) - eventTick) > getNadeMatchTickWindow(eventOnlyNade.nadeType)) {
            return false;
        }

        const candidateEnd = getNadeTrajectoryEndPoint(candidate) ?? { x: candidate.endX, y: candidate.endY };
        const dx = candidateEnd.x - eventEnd.x;
        const dy = candidateEnd.y - eventEnd.y;
        return dx * dx + dy * dy <= NADE_MATCH_DISTANCE_UNITS * NADE_MATCH_DISTANCE_UNITS;
    });
}

function shouldShowNadeThrowMarker(nade: NadeEvent, steamId: bigint): boolean {
    if (hasNadeTrajectory(nade)) return true;
    return !hasMatchingTrajectoryNade(nade, steamId);
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
    const duration = Math.max(1, round.endTick - activeStart);
    const laneLastTicks: number[] = [];

    return [...events]
        .sort((a, b) => a.tick - b.tick)
        .map((event, index) => {
            let lane = laneLastTicks.findIndex(lastTick => event.tick - lastTick > EVENT_STACK_WINDOW_TICKS);
            if (lane === -1) {
                lane = laneLastTicks.length;
            }
            laneLastTicks[lane] = event.tick;

            const leftPct = Math.max(0, Math.min(100, ((event.tick - activeStart) / duration) * 100));
            return {
                ...event,
                id: `${event.type}-${event.tick}-${index}`,
                lane,
                leftPct,
            };
        });
}

function buildSelectedPlayerBaseEvents(steamId: bigint, round: RoundData): BasePlayerTimelineEvent[] {
    if (!replayData) return [];

    const events: BasePlayerTimelineEvent[] = [];
    const roundKills = replayData.kills?.filter(kill =>
        kill.tick >= round.startTick && kill.tick <= round.endTick
    ) ?? [];

    for (const kill of roundKills) {
        if (kill.killerSteamId === steamId) {
            events.push({
                tick: kill.tick,
                type: 'kill',
                label: 'K',
                color: '#22c55e',
                title: `Killed ${getPlayerName(kill.victimSteamId)} with ${kill.weapon} at ${formatRoundEventTime(kill.tick, round)}`,
            });
        }
        if (kill.victimSteamId === steamId) {
            events.push({
                tick: kill.tick,
                type: 'death',
                label: 'X',
                color: '#ef4444',
                title: `Died to ${getPlayerName(kill.killerSteamId)} at ${formatRoundEventTime(kill.tick, round)}`,
            });
        }
    }

    for (const nade of replayData.nades ?? []) {
        if (nade.throwerSteamId !== steamId) continue;
        const meta = getNadeMeta(nade.nadeType);
        if (!meta || !shouldShowNadeThrowMarker(nade, steamId)) continue;

        const throwTick = getNadeThrowTick(nade);
        if (throwTick < round.startTick || throwTick > round.endTick) continue;

        events.push({
            tick: throwTick,
            type: meta.type,
            label: meta.label,
            color: meta.color,
            title: `Threw ${getNadeTypeName(nade.nadeType)} at ${formatRoundEventTime(throwTick, round)}`,
        });
    }

    return events;
}

function getBombEventsForRound(round: RoundData): BombEvent[] {
    return [...(replayData?.bombs ?? [])]
        .filter(event => event.tick >= round.startTick && event.tick <= round.endTick)
        .sort((a, b) => a.tick - b.tick);
}

function getBombEventForRound(round: RoundData, eventType: string): BombEvent | null {
    return getBombEventsForRound(round).find(event => event.eventType === eventType) ?? null;
}

function buildBombRoundEvents(round: RoundData): BasePlayerTimelineEvent[] {
    const events: BasePlayerTimelineEvent[] = [];
    const planted = getBombEventForRound(round, 'planted');
    const exploded = getBombEventForRound(round, 'exploded');
    const defused = getBombEventForRound(round, 'defused');

    if (planted) {
        const site = planted.site ? ` ${planted.site}` : '';
        events.push({
            tick: planted.tick,
            type: 'bomb_planted',
            label: 'BP',
            color: TEAM_T_COLOR,
            title: `Bomb planted${site} at ${formatRoundEventTime(planted.tick, round)}`,
        });
    }

    if (exploded || round.winReason === 'bomb_detonated') {
        const tick = exploded?.tick ?? round.endTick;
        events.push({
            tick,
            type: 'bomb_exploded',
            label: 'BE',
            color: TEAM_T_COLOR,
            title: `Bomb exploded at ${formatRoundEventTime(tick, round)}`,
        });
    }

    if (defused || round.winReason === 'bomb_defused') {
        const tick = defused?.tick ?? round.endTick;
        events.push({
            tick,
            type: 'bomb_defused',
            label: 'BD',
            color: TEAM_CT_COLOR,
            title: `Bomb defused at ${formatRoundEventTime(tick, round)}`,
        });
    }

    return events;
}

function buildTimelineEvents(selectedSteamId: bigint | null, round: RoundData): PlayerTimelineEvent[] {
    const events = buildBombRoundEvents(round);
    if (selectedSteamId !== null) {
        events.push(...buildSelectedPlayerBaseEvents(selectedSteamId, round));
    }
    return stackTimelineEvents(events, round);
}

function getTimelineEventsKey(round: RoundData | null, selectedSteamId: bigint | null): string {
    if (!round) return 'no-round';
    return `${round.roundNumber}:${round.startTick}:${round.endTick}:${selectedSteamId?.toString() ?? 'none'}`;
}

function updateTimelineEvents(round: RoundData | null): void {
    const nextKey = getTimelineEventsKey(round, selectedPlayerSteamId);
    if (nextKey === timelineEventsKey) return;

    timelineEventsKey = nextKey;
    timelineEvents = round ? buildTimelineEvents(selectedPlayerSteamId, round) : [];
}

function emptyBombStatus(): BombStatus {
    return { bombText: '', bombClass: '', defuseText: '', defuseClass: '' };
}

function getBombTimeSeconds(): number {
    return replayData?.header?.bombTimeSeconds || DEFAULT_BOMB_TIME_SECONDS;
}

function getBombCountdownEndTick(plant: BombEvent, round: RoundData): number {
    const exploded = getBombEventForRound(round, 'exploded');
    if (exploded && exploded.tick >= plant.tick) return exploded.tick;
    return plant.tick + Math.round(getBombTimeSeconds() * getTickRate());
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

function getActiveDefuseStatus(events: BombEvent[], plant: BombEvent, tick: number): string {
    const defuseStart = getLastBombEventBefore(events, 'defuse_start', tick);
    if (!defuseStart || defuseStart.tick < plant.tick) return '';
    if (hasBombEventBetween(events, ['defuse_aborted', 'defused', 'exploded'], defuseStart.tick, tick)) return '';
    if (defuseStart.playerSteamId !== 0n && !isPlayerAliveAtTick(defuseStart.playerSteamId, tick)) return '';

    const defuseSeconds = defuseStart.hasKit ? DEFUSE_SECONDS_WITH_KIT : DEFUSE_SECONDS_WITHOUT_KIT;
    const defuseEndTick = defuseStart.tick + Math.round(defuseSeconds * getTickRate());
    if (tick >= defuseEndTick) return '';

    const secondsLeft = Math.max(0, Math.ceil((defuseEndTick - tick) / getTickRate()));
    return `Defusing ${secondsLeft}s`;
}

function getRoundEndBombStatus(round: RoundData, tick: number): BombStatus | null {
    if (tick < round.endTick) return null;

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
    if (!plant) return roundEndStatus ?? emptyBombStatus();

    const exploded = getLastBombEventBefore(events, 'exploded', tick);
    if (exploded && exploded.tick >= plant.tick) {
        return {
            bombText: 'Bomb exploded, Terrorists Win!',
            bombClass: 'bomb-label-t',
            defuseText: '',
            defuseClass: '',
        };
    }
    if (roundEndStatus?.bombText) return roundEndStatus;

    const defused = getLastBombEventBefore(events, 'defused', tick);
    if (defused && defused.tick >= plant.tick) {
        return {
            bombText: '',
            bombClass: '',
            defuseText: 'Bomb has been defused. Counter Terrorists Win',
            defuseClass: 'bomb-label-ct',
        };
    }
    if (roundEndStatus?.defuseText) return roundEndStatus;

    const countdownEndTick = getBombCountdownEndTick(plant, round);
    const secondsLeft = Math.max(0, Math.ceil((countdownEndTick - tick) / getTickRate()));
    const upcomingDefuse = getFirstBombEventAfter(events, 'defused', tick);
    const defuseText = upcomingDefuse && upcomingDefuse.tick < countdownEndTick
        ? getActiveDefuseStatus(events, plant, tick)
        : getActiveDefuseStatus(events, plant, tick);

    return {
        bombText: `Bomb Planted ${secondsLeft}s`,
        bombClass: 'bomb-label-t',
        defuseText,
        defuseClass: defuseText ? 'bomb-label-ct' : '',
    };
}

function selectPlayer(steamId: bigint): void {
    selectedPlayerSteamId = selectedPlayerSteamId === steamId ? null : steamId;
    timelineEventsKey = '';
    updateReplayViewportTransform();
}

function isSelectedPlayer(steamId: bigint): boolean {
    return selectedPlayerSteamId === steamId;
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
        selectedPlayerSteamId = kill.killerSteamId;
        timelineEventsKey = '';
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

function resetReplayViewportTransform(): void {
    replayContainer?.style.setProperty('--replay-viewport-transform', 'none');
}

function updateReplayViewportTransform(tick = getPlaybackTick()): void {
    if (!browser || !replayContainer) return;

    if (!zoomSelectedPlayer || selectedPlayerSteamId === null || !replayData) {
        resetReplayViewportTransform();
        return;
    }

    const zoom = getSelectedPlayerZoomScale();
    if (zoom <= 1) {
        resetReplayViewportTransform();
        return;
    }

    const selectedFrame = getPlayerFrameAtTick(selectedPlayerSteamId, tick);
    if (!selectedFrame) {
        resetReplayViewportTransform();
        return;
    }

    const rect = replayContainer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        resetReplayViewportTransform();
        return;
    }

    const focus = worldToCanvas(selectedFrame.x, selectedFrame.y, mapMetadata, {
        width: rect.width,
        height: rect.height,
    });
    const translateX = rect.width / 2 - focus.x * zoom;
    const translateY = rect.height / 2 - focus.y * zoom;

    replayContainer.style.setProperty(
        '--replay-viewport-transform',
        `translate(${translateX.toFixed(2)}px, ${translateY.toFixed(2)}px) scale(${zoom.toFixed(3)})`
    );
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
    const maxTick = round ? round.endTick : (replayData.header?.totalTicks || 1) - 1;

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
        const roundDuration = round.endTick - as;
        const progress = roundDuration > 0 ? (tickInRound / roundDuration) * 100 : 0;
        roundProgressPct = Math.max(0, Math.min(100, progress));
        activeStart = as;
    } else {
        roundProgressPct = 0;
        activeStart = 0;
    }
}

$: {
    void replayData;
    const nextPlayablePlayers = getPlayablePlayers();
    playablePlayers = nextPlayablePlayers;
    rebuildPlayerFrameIndex(nextPlayablePlayers);

    if (
        selectedPlayerSteamId !== null &&
        !nextPlayablePlayers.some(player => player.steamId === selectedPlayerSteamId)
    ) {
        selectedPlayerSteamId = null;
        timelineEventsKey = '';
        updateReplayViewportTransform();
    }
}

$: {
    void replayData, displayTick, playablePlayers, selectedPlayerSteamId;
    const round = getCurrentRoundData(displayTick) ?? getPlaybackStartRound(displayTick);
    const rosterEntries = buildRosterEntries(round, displayTick);
    ctRoster = rosterEntries.filter(entry => entry.side === TEAM_CT);
    tRoster = rosterEntries.filter(entry => entry.side === TEAM_T);
    ctAliveCount = ctRoster.filter(entry => entry.isAlive).length;
    tAliveCount = tRoster.filter(entry => entry.isAlive).length;
    updateTimelineEvents(round);
    bombStatus = getBombStatus(displayTick);
}

$: {
    void zoomSelectedPlayer, selectedPlayerZoomPercent, selectedPlayerSteamId, replayData, mapMetadata;
    updateReplayViewportTransform();
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
    if (e.key === ' ') {
        e.preventDefault();
        setPlaying(!isPlaying);
    }
}

function handleViewportResize() {
    updateReplayViewportTransform();
}

onMount(() => {
    if (!browser) return;
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleViewportResize);
    updateReplayViewportTransform();
    return () => {
        window.removeEventListener('keydown', handleKeydown);
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
    height: 86px;
    background: #1a1a24;
    border-bottom: 1px solid #2a2a40;
    padding: 0 20px;
    z-index: 100;
    box-sizing: border-box;
    padding-top: 10px;
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
    height: 48px;
    margin-top: 8px;
}

.event-marker {
    position: absolute;
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
    z-index: 1;
}

.event-marker:hover {
    filter: brightness(1.14);
    z-index: 3;
}

.bomb-status {
    position: absolute;
    top: 96px;
    left: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    transform: translateX(-50%);
    z-index: 112;
    pointer-events: none;
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
}

.sight-controls {
    position: absolute;
    top: 134px;
    left: 20px;
    width: 252px;
    background: rgba(26, 26, 36, 0.86);
    border: 1px solid #2a2a40;
    border-radius: 6px;
    padding: 10px 12px;
    z-index: 100;
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

.player-roster {
    position: absolute;
    top: 96px;
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
}

.roster-player:hover {
    background: rgba(59, 130, 246, 0.18);
    border-color: rgba(96, 165, 250, 0.45);
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
<div class="replay-container" bind:this={replayContainer}>
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
                    const roundDuration = round.endTick - activeStart;
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
                    class="event-marker"
                    style="left: {playerEvent.leftPct}%; top: {playerEvent.lane * 18}px; --marker-color: {playerEvent.color}; color: {playerEvent.type === 'death' ? '#ffffff' : '#0f172a'};"
                    title={playerEvent.title}
                    onclick={() => seekToPlayerEvent(playerEvent.tick)}
                    ondblclick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void copyTickCommand(playerEvent.tick);
                    }}
                >
                    {playerEvent.label}
                </button>
            {/each}
        </div>
    </div>

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
    />
    <PlayerLayer 
        bind:replayData={replayData}
        bind:mapMetadata={mapMetadata}
        bind:isPlaying={isPlaying}
        {sightConeLength}
        {sightConeHalfAngle}
        {showLineOfSight}
        {lineOfSightLength}
        {selectedPlayerSteamId}
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
        onselectkillfeed={handleKillFeedSelect}
    />

    <Controls
        {isPlaying}
        {playbackSpeed}
        speedOptions={SPEED_OPTIONS}
        ontoggleplay={togglePlay}
        onsetspeed={setSpeed}
    />

    <TimeDisplay currentTick={displayTick} activeStart={activeStart} />

    <div class="sight-controls">
        <section class="control-section">
            <div class="controls-heading">Sight Cone Controls</div>
            <label class="sight-control">
                <span>Width</span>
                <input
                    type="range"
                    min="0.16"
                    max="0.8"
                    step="0.02"
                    bind:value={sightConeHalfAngle}
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
                />
                <span class="sight-control-value">{Math.round(sightConeLength)}</span>
            </label>
            <label class="checkbox-control">
                <input type="checkbox" bind:checked={showLineOfSight} />
                <span>Show Line of Sight</span>
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
            <label class="checkbox-control">
                <input type="checkbox" bind:checked={zoomSelectedPlayer} />
                <span>Zoom Selected Player</span>
            </label>
            <label class="sight-control">
                <span>Zoom</span>
                <input
                    type="range"
                    min="100"
                    max="500"
                    step="25"
                    bind:value={selectedPlayerZoomPercent}
                    disabled={!zoomSelectedPlayer}
                />
                <span class="sight-control-value">{Math.round(selectedPlayerZoomPercent)}%</span>
            </label>
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
