<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { create, fromBinary } from '@bufbuild/protobuf';
import { ReplayDataSchema, MapDataSchema } from '$lib/types/replay/replay_pb';
import type { ReplayData, RoundData, MapData as MapMetadata } from '$lib/types/replay/replay_pb';
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

let activeStart: number = 0;

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
        roundProgressPct = roundDuration > 0 ? (tickInRound / roundDuration) * 100 : 0;
        activeStart = as;
    } else {
        roundProgressPct = 0;
        activeStart = 0;
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
    height: 40px;
    background: #1a1a24;
    border-bottom: 1px solid #2a2a40;
    display: flex;
    align-items: center;
    padding: 0 20px;
    z-index: 100;
}

.timeline-track {
    flex: 1;
    height: 20px;
    background: #2a2a40;
    border-radius: 10px;
    position: relative;
    cursor: pointer;
}

.timeline-track {
    position: relative;
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
            on:click={(e) => {
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
            on:keydown={(e) => {
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

    <RoundNav {replayData} currentTick={displayTick} onseekround={seekToRound} />
</div>
{:else}
<div class="empty-state">
    <div class="empty-state-content">
        <h2 class="empty-state-title">CS2 Replay Viewer</h2>
        <p class="empty-state-text">No replay loaded. Select a .dem file to begin.</p>
        <button class="load-button" on:click={loadDemo} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Load Demo File'}
        </button>
    </div>
</div>
{/if}
