<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { worldToCanvas } from '$lib/canvas/transforms';
import { getPlaybackTick, subscribePlaybackTick } from '$lib/playback-state';
import type { ReplayData, PlayerFrame, MapData as MapMetadata } from '$lib/types/replay/replay_pb';

export let replayData: ReplayData | null = null;
export let mapMetadata: MapMetadata;
export let isPlaying: boolean = false;
export let sightConeLength: number = 34;
export let sightConeHalfAngle: number = 0.32;

let container: HTMLElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

let playerFrames = new Map<string, PlayerFrame>();
let trails: Map<string, PlayerFrame[]> = new Map();
let playerFrameIndices = new Map<string, number>();
let trailLength = 128;

let trailCache = new Map<string, PlayerFrame[]>();
let trailCursor = new Map<string, number>();
let cachedRoundKey: string | null = null;
let unsubscribeTick: (() => void) | null = null;

const MAX_INTERPOLATION_GAP_TICKS = 16;
const TEAM_T = 2;
const TEAM_CT = 3;

function lerp(start: number, end: number, alpha: number): number {
    return start + (end - start) * alpha;
}

function lerpAngle(start: number, end: number, alpha: number): number {
    const delta = ((end - start + 540) % 360) - 180;
    return start + delta * alpha;
}

function interpolateFrame(current: PlayerFrame, next: PlayerFrame | undefined, tick: number): PlayerFrame {
    if (!next || next.tick <= current.tick) return current;

    const tickGap = next.tick - current.tick;
    if (tickGap > MAX_INTERPOLATION_GAP_TICKS) return current;

    const alpha = Math.max(0, Math.min(1, (tick - current.tick) / tickGap));
    if (alpha <= 0) return current;

    return {
        ...current,
        x: lerp(current.x, next.x, alpha),
        y: lerp(current.y, next.y, alpha),
        z: lerp(current.z, next.z, alpha),
        yaw: lerpAngle(current.yaw, next.yaw, alpha),
        pitch: lerp(current.pitch, next.pitch, alpha),
    };
}

function initializeTrails(): void {
    trails.clear();
    playerFrameIndices.clear();
    trailCache.clear();
    trailCursor.clear();
    cachedRoundKey = null;
    cachedKills = null;
    cachedKillsKey = null;
    if (!replayData?.frames) return;

    const playableSteamIds = getPlayableSteamIds();
    if (playableSteamIds.size === 0) return;
    
    for (const frame of replayData.frames) {
        const steamId = frame.steamId.toString();
        if (!playableSteamIds.has(steamId)) continue;
        if (!trails.has(steamId)) {
            trails.set(steamId, []);
        }
        trails.get(steamId)?.push(frame);
    }
}

function getPlayableSteamIds(): Set<string> {
    const ids = new Set<string>();
    for (const player of replayData?.players ?? []) {
        if (player.team === TEAM_T || player.team === TEAM_CT) {
            ids.add(player.steamId.toString());
        }
    }
    return ids;
}

function updatePlayerFrames(tick: number): void {
    playerFrames.clear();
    if (!replayData?.frames) return;
    
    for (const [steamId, trail] of trails) {
        let idx = playerFrameIndices.get(steamId) ?? 0;
        
        if (idx >= trail.length || trail[idx].tick > tick) {
            let lo = 0, hi = trail.length - 1, best = 0;
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
        
        playerFrameIndices.set(steamId, idx);
        playerFrames.set(steamId, interpolateFrame(trail[idx], trail[idx + 1], tick));
    }
}

// Look up the team for a player by steamId
function getCurrentRoundData(tick: number): any {
    if (!replayData?.rounds) return null;
    for (const round of replayData.rounds) {
        if (tick >= round.startTick && tick <= round.endTick) {
            return round;
        }
    }
    return null;
}

function getCurrentRoundRange(tick: number): { startTick: number; endTick: number } | null {
    if (!replayData?.rounds || replayData.rounds.length === 0) return null;
    for (const round of replayData.rounds) {
        if (tick >= round.startTick && tick <= round.endTick) {
            return { startTick: round.startTick, endTick: round.endTick };
        }
    }
    return null;
}

function getPlayerTeam(steamId: string, tick: number): number {
    if (!replayData?.players) return 0;
    const id = BigInt(steamId);
    const player = replayData.players.find(p => p.steamId === id);
    if (!player) return 0;
    
    // The stored team is from the end of the match (second half).
    // In CS2 MR12, teams switch after round 12.
    // For rounds before the side switch, flip T<->CT.
    const round = getCurrentRoundData(tick);
    if (round) {
        // Regulation: half size = 12. Overtime: half size = 3.
        const halfSize = round.roundNumber <= 24 ? 12 : 3;
        const halfIndex = Math.floor((round.roundNumber - 1) / halfSize);
        const isOddHalf = halfIndex % 2 === 0;
        if (isOddHalf) {
            if (player.team === 2) return 3;
            if (player.team === 3) return 2;
        }
    }
    
    return player.team;
}

function getPlayerName(steamId: string): string {
    if (!replayData?.players) return `Player ${steamId}`;
    const id = BigInt(steamId);
    const player = replayData.players.find(p => p.steamId === id);
    return player?.name || `Player ${steamId}`;
}

function updateTrailCache(tick: number): void {
    const roundRange = getCurrentRoundRange(tick);
    const roundKey = roundRange ? `${roundRange.startTick}-${roundRange.endTick}` : 'full';

    if (roundKey !== cachedRoundKey) {
        trailCache.clear();
        trailCursor.clear();
        cachedRoundKey = roundKey;

        for (const [steamId, fullTrail] of trails) {
            let filtered: PlayerFrame[];
            if (roundRange) {
                filtered = fullTrail.filter(f =>
                    f.tick >= roundRange.startTick && f.tick <= roundRange.endTick
                );
            } else {
                filtered = [...fullTrail];
            }
            trailCache.set(steamId, filtered);
            trailCursor.set(steamId, -1);
        }
    }

    for (const [steamId, trail] of trailCache) {
        let cur = trailCursor.get(steamId) ?? -1;
        if (cur >= 0 && cur < trail.length && trail[cur].tick <= tick) {
            while (cur + 1 < trail.length && trail[cur + 1].tick <= tick) {
                cur++;
            }
        } else {
            let lo = 0, hi = trail.length - 1, best = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >>> 1;
                if (trail[mid].tick <= tick) {
                    best = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
            cur = best;
        }
        trailCursor.set(steamId, cur);
    }
}

function getCachedTrail(steamId: string): PlayerFrame[] {
    const trail = trailCache.get(steamId);
    if (!trail) return [];
    const endIdx = trailCursor.get(steamId) ?? -1;
    if (endIdx < 0) return [];
    const startIdx = Math.max(0, endIdx - trailLength + 1);
    return trail.slice(startIdx, endIdx + 1);
}

function drawPlayerSightCone(
    ctx: CanvasRenderingContext2D,
    frame: PlayerFrame,
    pos: { x: number; y: number },
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number }
): void {
    if (!Number.isFinite(frame.yaw)) return;

    const yawRad = frame.yaw * Math.PI / 180;
    const lookTarget = worldToCanvas(
        frame.x + Math.cos(yawRad) * 128,
        frame.y + Math.sin(yawRad) * 128,
        mapMetadata,
        canvasSize
    );
    const angle = Math.atan2(lookTarget.y - pos.y, lookTarget.x - pos.x);
    const coneLength = Math.max(8, sightConeLength);
    const coneHalfAngle = Math.max(0.05, sightConeHalfAngle);
    const leftAngle = angle - coneHalfAngle;
    const rightAngle = angle + coneHalfAngle;
    const leftX = pos.x + Math.cos(leftAngle) * coneLength;
    const leftY = pos.y + Math.sin(leftAngle) * coneLength;
    const rightX = pos.x + Math.cos(rightAngle) * coneLength;
    const rightY = pos.y + Math.sin(rightAngle) * coneLength;
    const tipX = pos.x + Math.cos(angle) * (coneLength + 4);
    const tipY = pos.y + Math.sin(angle) * (coneLength + 4);

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(leftX, leftY);
    ctx.quadraticCurveTo(tipX, tipY, rightX, rightY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function drawPlayer(
    ctx: CanvasRenderingContext2D,
    frame: PlayerFrame,
    steamId: string,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    tick: number
): void {
    const pos = worldToCanvas(frame.x, frame.y, mapMetadata, canvasSize);
    
    const isAlive = frame.isAlive ?? true;
    const team = getPlayerTeam(steamId, tick);
    if (team !== TEAM_T && team !== TEAM_CT) return;

    const teamColor = team === 2 ? '#f97316' : team === 3 ? '#3b82f6' : '#6b7280';

    if (isAlive) {
        drawPlayerSightCone(ctx, frame, pos, mapMetadata, canvasSize);
    }
    
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = isAlive ? teamColor : '#6b7280';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    if (isAlive) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';

        const playerName = getPlayerName(steamId);
        const weapon = frame.weapon || '';
        const nameY = weapon ? pos.y - 24 : pos.y - 10;

        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillStyle = teamColor;
        ctx.strokeText(playerName, pos.x, nameY);
        ctx.fillText(playerName, pos.x, nameY);

        if (weapon) {
            ctx.font = '12px Inter, sans-serif';
            ctx.fillStyle = '#e2e8f0';
            ctx.strokeText(weapon, pos.x, pos.y - 10);
            ctx.fillText(weapon, pos.x, pos.y - 10);
        }
    }
    
    const healthColor = frame.health && frame.health < 50 ? '#ef4444' : '#4ade80';
    ctx.fillStyle = healthColor;
    ctx.fillRect(pos.x - 10, pos.y + 8, 20 * (frame.health || 100) / 100, 3);
}

function drawPlayerTrail(
    ctx: CanvasRenderingContext2D,
    trail: PlayerFrame[],
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number }
): void {
    if (trail.length < 2) return;
    
    ctx.beginPath();
    
    const firstFrame = trail[0];
    const firstPos = worldToCanvas(firstFrame.x, firstFrame.y, mapMetadata, canvasSize);
    ctx.moveTo(firstPos.x, firstPos.y);
    
    for (let i = 1; i < trail.length; i++) {
        const frame = trail[i];
        const pos = worldToCanvas(frame.x, frame.y, mapMetadata, canvasSize);
        ctx.lineTo(pos.x, pos.y);
    }
    
    ctx.strokeStyle = 'rgba(156, 163, 175, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

let cachedKills: any[] | null = null;
let cachedKillsKey: string | null = null;

function getCachedKillsInCurrentRound(tick: number): any[] {
    const roundRange = getCurrentRoundRange(tick);
    const key = roundRange ? `${roundRange.startTick}-${roundRange.endTick}` : 'full';
    if (key !== cachedKillsKey || cachedKills === null) {
        cachedKillsKey = key;
        if (!roundRange || !replayData?.kills) {
            cachedKills = replayData?.kills || [];
        } else {
            cachedKills = replayData.kills.filter(k =>
                k.tick >= roundRange.startTick && k.tick <= roundRange.endTick
            );
        }
    }
    return cachedKills;
}

function drawKillMarkers(
    ctx: CanvasRenderingContext2D,
    kills: any[],
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    currentTick: number
): void {
    const recentKills = kills.filter(k => 
        k.tick >= currentTick - 64 && k.tick <= currentTick
    );
    
    for (const kill of recentKills) {
        const pos = worldToCanvas(kill.victimX, kill.victimY, mapMetadata, canvasSize);
        
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(pos.x - 8, pos.y - 8);
        ctx.lineTo(pos.x + 8, pos.y + 8);
        ctx.moveTo(pos.x + 8, pos.y - 8);
        ctx.lineTo(pos.x - 8, pos.y + 8);
        ctx.stroke();
    }
}

let rafId: number | null = null;
let renderLoopId: number | null = null;

function scheduleRender() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
        rafId = null;
        render();
    });
}

function startRenderLoop() {
    if (renderLoopId !== null) return;

    const loop = () => {
        render();
        renderLoopId = requestAnimationFrame(loop);
    };

    renderLoopId = requestAnimationFrame(loop);
}

function stopRenderLoop() {
    if (renderLoopId === null) return;
    cancelAnimationFrame(renderLoopId);
    renderLoopId = null;
}

function resizeCanvas(container: HTMLElement): { width: number; height: number } {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    if (ctx) {
        ctx.canvas.width = width;
        ctx.canvas.height = height;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    return { width, height };
}

function render() {
    if (!browser || !ctx || !container || !replayData) return;

    try {
        const playbackTick = getPlaybackTick();
        const tick = Math.floor(playbackTick);
        updatePlayerFrames(playbackTick);
        updateTrailCache(tick);

        const canvasSize = {
            width: container.clientWidth,
            height: container.clientHeight,
        };

        ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

        for (const [steamId] of trails) {
            const trail = getCachedTrail(steamId);
            drawPlayerTrail(ctx, trail, mapMetadata, canvasSize);
        }

        drawKillMarkers(ctx, getCachedKillsInCurrentRound(tick), mapMetadata, canvasSize, tick);

        for (const [steamId, frame] of playerFrames) {
            drawPlayer(ctx, frame, steamId, mapMetadata, canvasSize, tick);
        }
    } catch (error) {
        console.error('Error rendering player layer:', error);
    }
}

onMount(() => {
    if (!browser) return;

    if (container) {
        ctx = container.getContext('2d')!;
        resizeCanvas(container);
    }

    try {
        if (replayData) {
            initializeTrails();
            updatePlayerFrames(getPlaybackTick());
            updateTrailCache(Math.floor(getPlaybackTick()));
            render();
        }
    } catch (error) {
        console.error('Error initializing player layer:', error);
    }

    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);
    unsubscribeTick = subscribePlaybackTick(scheduleRender);
});

$: {
    void isPlaying;
    if (browser) {
        if (isPlaying) {
            startRenderLoop();
        } else {
            stopRenderLoop();
            scheduleRender();
        }
    }
}

$: {
    void replayData;
    if (replayData && ctx) {
        initializeTrails();
        updatePlayerFrames(getPlaybackTick());
        updateTrailCache(Math.floor(getPlaybackTick()));
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        render();
    }
}

$: {
    void sightConeLength, sightConeHalfAngle;
    if (browser && ctx) {
        scheduleRender();
    }
}

let resizeTimeout: ReturnType<typeof setTimeout>;
function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (container) {
            resizeCanvas(container);
            render();
        }
    }, 150);
}

function handleVisibility() {
    if (document.visibilityState === 'visible') {
        render();
    }
}

onDestroy(() => {
    if (browser) {
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('visibilitychange', handleVisibility);
    }
    if (resizeTimeout) clearTimeout(resizeTimeout);
    if (rafId !== null) cancelAnimationFrame(rafId);
    stopRenderLoop();
    unsubscribeTick?.();
});
</script>

<style>
.player-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
    border-radius: 8px;
}

.player-layer.canvas {
    image-rendering: pixelated;
    image-rendering: -webkit-crisp-edges;
    image-rendering: -moz-crisp-edges;
}
</style>

<canvas 
    bind:this={container}
    class="player-layer canvas"
    style="width: 100%; height: 100%;"
></canvas>
