<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { worldToCanvas } from '$lib/canvas/transforms';
import type { ReplayData, PlayerFrame, MapData as MapMetadata } from '$lib/types/replay/replay_pb';

export let replayData: ReplayData | null = null;
export let mapMetadata: MapMetadata;
export let currentTick: number = 0;
export let isPlaying: boolean = false;
export let imgOffsetX: number = 0;
export let imgOffsetY: number = 0;
export let imgScaleX: number = 1;
export let imgScaleY: number = 1;

let container: HTMLElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

let playerFrames = new Map<string, PlayerFrame>();
let trails: Map<string, PlayerFrame[]> = new Map();
let playerFrameIndices = new Map<string, number>();
let trailLength = 128;

function initializeTrails(): void {
    trails.clear();
    playerFrameIndices.clear();
    if (!replayData?.frames) return;
    
    for (const frame of replayData.frames) {
        const steamId = frame.steamId.toString();
        if (!trails.has(steamId)) {
            trails.set(steamId, []);
        }
        trails.get(steamId)?.push(frame);
    }
}

function updatePlayerFrames(): void {
    playerFrames.clear();
    if (!replayData?.frames) return;
    
    for (const [steamId, trail] of trails) {
        let idx = playerFrameIndices.get(steamId) ?? 0;
        
        if (idx >= trail.length || trail[idx].tick > currentTick) {
            let lo = 0, hi = trail.length - 1, best = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >>> 1;
                if (trail[mid].tick <= currentTick) {
                    best = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
            idx = best;
        } else {
            while (idx < trail.length - 1 && trail[idx + 1].tick <= currentTick) {
                idx++;
            }
        }
        
        playerFrameIndices.set(steamId, idx);
        playerFrames.set(steamId, trail[idx]);
    }
}

// Look up the team for a player by steamId
function getCurrentRoundData(): any {
    if (!replayData?.rounds) return null;
    for (const round of replayData.rounds) {
        if (currentTick >= round.startTick && currentTick <= round.endTick) {
            return round;
        }
    }
    return null;
}

function getCurrentRoundRange(): { startTick: number; endTick: number } | null {
    if (!replayData?.rounds || replayData.rounds.length === 0) return null;
    for (const round of replayData.rounds) {
        if (currentTick >= round.startTick && currentTick <= round.endTick) {
            return { startTick: round.startTick, endTick: round.endTick };
        }
    }
    return null;
}

function getPlayerTeam(steamId: string): number {
    if (!replayData?.players) return 0;
    const id = BigInt(steamId);
    const player = replayData.players.find(p => p.steamId === id);
    if (!player) return 0;
    
    // The stored team is from the end of the match (second half).
    // In CS2 MR12, teams switch after round 12.
    // For rounds before the side switch, flip T<->CT.
    const round = getCurrentRoundData();
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

function getPlayerTrail(steamId: string): PlayerFrame[] {
    const trail = trails.get(steamId);
    if (!trail) return [];
    
    const roundRange = getCurrentRoundRange();
    
    let filteredTrail = trail.filter(f => f.tick <= currentTick);
    
    if (roundRange) {
        filteredTrail = filteredTrail.filter(f =>
            f.tick >= roundRange.startTick && f.tick <= roundRange.endTick
        );
    }
    
    const maxFrames = trailLength;
    if (filteredTrail.length > maxFrames) {
        return filteredTrail.slice(-maxFrames);
    }
    
    return filteredTrail;
}

function drawPlayer(
    ctx: CanvasRenderingContext2D,
    frame: PlayerFrame,
    steamId: string,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number }
): void {
    const pos = worldToCanvas(frame.x, frame.y, mapMetadata, canvasSize, 0, 0, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY);
    
    const isAlive = frame.isAlive ?? true;
    const team = getPlayerTeam(steamId);
    const teamColor = team === 2 ? '#f97316' : team === 3 ? '#3b82f6' : '#6b7280';
    
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = isAlive ? teamColor : '#6b7280';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    if (isAlive && frame.weapon) {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(frame.weapon, pos.x, pos.y - 10);
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
    const firstPos = worldToCanvas(firstFrame.x, firstFrame.y, mapMetadata, canvasSize, 0, 0, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY);
    ctx.moveTo(firstPos.x, firstPos.y);
    
    for (let i = 1; i < trail.length; i++) {
        const frame = trail[i];
        const pos = worldToCanvas(frame.x, frame.y, mapMetadata, canvasSize, 0, 0, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY);
        ctx.lineTo(pos.x, pos.y);
    }
    
    ctx.strokeStyle = 'rgba(156, 163, 175, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function getKillsInCurrentRound(): any[] {
    if (!replayData?.rounds || replayData.rounds.length === 0) return replayData?.kills || [];
    const roundRange = getCurrentRoundRange();
    if (!roundRange) return replayData?.kills || [];
    return (replayData?.kills || []).filter(k =>
        k.tick >= roundRange.startTick && k.tick <= roundRange.endTick
    );
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
        const pos = worldToCanvas(kill.victimX, kill.victimY, mapMetadata, canvasSize, 0, 0, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY);
        
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

function resizeCanvas(container: HTMLElement): { width: number; height: number } {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    if (ctx) {
        ctx.canvas.width = width;
        ctx.canvas.height = height;
        ctx.scale(dpr, dpr);
    }

    return { width, height };
}

function render() {
    if (!browser || !ctx || !container || !replayData) return;

    try {
        const canvasSize = {
            width: container.clientWidth,
            height: container.clientHeight,
        };

        ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

        for (const [steamId] of trails) {
            const trail = getPlayerTrail(steamId);
            drawPlayerTrail(ctx, trail, mapMetadata, canvasSize);
        }

        drawKillMarkers(ctx, getKillsInCurrentRound(), mapMetadata, canvasSize, currentTick);

        for (const [steamId, frame] of playerFrames) {
            drawPlayer(ctx, frame, steamId, mapMetadata, canvasSize);
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
            updatePlayerFrames();
            render();
        }
    } catch (error) {
        console.error('Error initializing player layer:', error);
    }

    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);
});

$: {
    void currentTick, isPlaying, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY;
    if (replayData && ctx) {
        updatePlayerFrames();
        render();
    }
}

$: {
    void replayData, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY;
    if (replayData && ctx) {
        initializeTrails();
        updatePlayerFrames();
        render();
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
    if (resizeTimeout) {
        clearTimeout(resizeTimeout);
    }
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
