<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { create, fromBinary } from '@bufbuild/protobuf';
import { ReplayDataSchema, MapDataSchema } from '$lib/types/replay/replay_pb';
import type {
    NadeEvent,
    PlayerFrame,
    PlayerInfo,
    ReplayData,
    RoundData,
    MapData as MapMetadata,
} from '$lib/types/replay/replay_pb';
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
const EVENT_SEEK_LEAD_TICKS = 128;
const EVENT_STACK_WINDOW_TICKS = 128;
const NADE_MATCH_DISTANCE_UNITS = 240;
const NADE_MATCH_TICK_WINDOW = 768;
const SMOKE_MATCH_TICK_WINDOW = 1536;

let activeStart: number = 0;
let sightConeLength = DEFAULT_SIGHT_CONE_LENGTH;
let sightConeHalfAngle = DEFAULT_SIGHT_CONE_HALF_ANGLE;
let selectedPlayerSteamId: bigint | null = null;
let playablePlayers: PlayerInfo[] = [];
let ctRoster: RosterEntry[] = [];
let tRoster: RosterEntry[] = [];
let selectedPlayerEvents: PlayerTimelineEvent[] = [];
let playerFrameTrails = new Map<string, PlayerFrame[]>();
let playerFrameLookupIndices = new Map<string, number>();

type RosterEntry = {
    player: PlayerInfo;
    side: number;
    isAlive: boolean;
    color: string;
};

type PlayerEventType = 'kill' | 'death' | 'smoke' | 'flashbang' | 'molotov' | 'hegrenade' | 'decoy';

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

function buildSelectedPlayerEvents(steamId: bigint, round: RoundData): PlayerTimelineEvent[] {
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

    return stackTimelineEvents(events, round);
}

function selectPlayer(steamId: bigint): void {
    selectedPlayerSteamId = steamId;
}

function isSelectedPlayer(steamId: bigint): boolean {
    return selectedPlayerSteamId === steamId;
}

function seekToPlayerEvent(eventTick: number): void {
    const round = getRoundForTick(eventTick) ?? getCurrentRoundData(displayTick);
    const roundStart = round ? getRoundActiveStart(round) : 0;
    setTick(Math.max(roundStart, eventTick - EVENT_SEEK_LEAD_TICKS));
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
    }
}

$: {
    void replayData, displayTick, playablePlayers, selectedPlayerSteamId;
    const round = getCurrentRoundData(displayTick) ?? getPlaybackStartRound(displayTick);
    const rosterEntries = buildRosterEntries(round, displayTick);
    ctRoster = rosterEntries.filter(entry => entry.side === TEAM_CT);
    tRoster = rosterEntries.filter(entry => entry.side === TEAM_T);
    selectedPlayerEvents = selectedPlayerSteamId !== null && round
        ? buildSelectedPlayerEvents(selectedPlayerSteamId, round)
        : [];
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

function nextKill() {
    if (!replayData?.kills) return;
    const tick = Math.floor(getPlaybackTick());
    const currentKills = replayData.kills.filter(k => k.tick >= tick);
    if (currentKills.length > 0) {
        setTick(currentKills[0].tick);
    }
}

function prevKill() {
    if (!replayData?.kills) return;
    const tick = Math.floor(getPlaybackTick());
    const currentKills = replayData.kills.filter(k => k.tick <= tick);
    if (currentKills.length > 0) {
        setTick(currentKills[currentKills.length - 1].tick);
    }
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === ' ') {
        e.preventDefault();
        setPlaying(!isPlaying);
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const totalTicks = replayData?.header?.totalTicks || 1;
        const step = Math.floor(totalTicks / 100);
        setTick(Math.min(Math.floor(getPlaybackTick()) + step, totalTicks));
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const totalTicks = replayData?.header?.totalTicks || 1;
        const step = Math.floor(totalTicks / 100);
        setTick(Math.max(Math.floor(getPlaybackTick()) - step, 0));
    }
}

onMount(() => {
    if (!browser) return;
    window.addEventListener('keydown', handleKeydown);
    return () => {
        window.removeEventListener('keydown', handleKeydown);
        if (rafId) cancelAnimationFrame(rafId);
    };
});
</script>

<style>
.replay-container {
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

.sight-controls {
    position: absolute;
    top: 134px;
    left: 20px;
    width: 220px;
    background: rgba(26, 26, 36, 0.86);
    border: 1px solid #2a2a40;
    border-radius: 6px;
    padding: 10px 12px;
    z-index: 100;
}

.sight-control {
    display: grid;
    grid-template-columns: 56px 1fr 34px;
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

.sight-control-value {
    color: #94a3b8;
    font-family: 'JetBrains Mono', monospace;
    text-align: right;
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
<div class="replay-container">
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
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    const round = getCurrentRoundData();
                    if (round) {
                        const activeStart = getRoundActiveStart(round);
                        const roundDuration = round.endTick - activeStart;
                        const step = Math.floor(roundDuration / 100);
                        setTick(Math.floor(getPlaybackTick()) + (e.key === 'ArrowRight' ? step : -step));
                    } else {
                        const totalTicks = replayData?.header?.totalTicks || 1;
                        const step = Math.floor(totalTicks / 100);
                        setTick(Math.floor(getPlaybackTick()) + (e.key === 'ArrowRight' ? step : -step));
                    }
                }
            }}>
            <div class="timeline-fill" style="width: {roundProgressPct}%;"></div>
            <div class="timeline-knob" style="left: {roundProgressPct}%;"></div>
        </div>
        <div class="event-marker-track">
            {#each selectedPlayerEvents as playerEvent (playerEvent.id)}
                <button
                    class="event-marker"
                    style="left: {playerEvent.leftPct}%; top: {playerEvent.lane * 18}px; --marker-color: {playerEvent.color}; color: {playerEvent.type === 'death' ? '#ffffff' : '#0f172a'};"
                    title={playerEvent.title}
                    onclick={() => seekToPlayerEvent(playerEvent.tick)}
                >
                    {playerEvent.label}
                </button>
            {/each}
        </div>
    </div>

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
    />

    <Controls
        {isPlaying}
        {playbackSpeed}
        speedOptions={SPEED_OPTIONS}
        ontoggleplay={togglePlay}
        onprevkill={prevKill}
        onnextkill={nextKill}
        onsetspeed={setSpeed}
    />

    <TimeDisplay currentTick={displayTick} activeStart={activeStart} />

    <div class="sight-controls">
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
                max="80"
                step="1"
                bind:value={sightConeLength}
            />
            <span class="sight-control-value">{Math.round(sightConeLength)}</span>
        </label>
    </div>

    <div class="player-roster">
        <div class="roster-columns">
            <div class="roster-column">
                <div class="roster-title">CT</div>
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
                <div class="roster-title">T</div>
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
