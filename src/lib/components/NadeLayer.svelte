<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { worldToCanvas } from '$lib/canvas/transforms';
import { getPlaybackTick, subscribePlaybackTick } from '$lib/playback-state';
import type { ReplayData, NadeEvent, MapData as MapMetadata } from '$lib/types/replay/replay_pb';

export let replayData: ReplayData | null = null;
export let mapMetadata: MapMetadata;
export let isPlaying: boolean = false;
export let imgOffsetX: number = 0;
export let imgOffsetY: number = 0;
export let imgScaleX: number = 1;
export let imgScaleY: number = 1;

let container: HTMLElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let unsubscribeTick: (() => void) | null = null;

const TRAJECTORY_FADE_DURATION = 192; // ~3 seconds at 64 tick

function drawNade(
    ctx: CanvasRenderingContext2D,
    nade: NadeEvent,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    tick: number,
    isEffect: boolean = false
): void {
    const pos = worldToCanvas(
        isEffect ? nade.endX : nade.startX,
        isEffect ? nade.endY : nade.startY,
        mapMetadata,
        canvasSize,
        0, 0,
        imgOffsetX, imgOffsetY, imgScaleX, imgScaleY
    );
    
    if (nade.nadeType === 'smoke') {
        // Draw smoke projectile (arc) when thrown
        if (!isEffect) {
            ctx.strokeStyle = '#9ca3af';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 25, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        
        // Draw effect zone if active
        if (isEffect || (nade.detonationTick && nade.detonationTick <= tick && nade.fadeTick && nade.fadeTick >= tick)) {
            ctx.fillStyle = 'rgba(156, 163, 175, 0.35)';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 50, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (nade.nadeType === 'hegrenade') {
        if (!isEffect) {
            // Draw HE projectile
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 25, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        if (isEffect) {
            ctx.fillStyle = 'rgba(249, 115, 22, 0.3)';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 62, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (nade.nadeType === 'flashbang') {
        // Flashbang: small projectile, expands into effect
        if (!isEffect) {
            ctx.strokeStyle = '#fde047';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 25, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        if (isEffect) {
            ctx.fillStyle = 'rgba(253, 224, 71, 0.2)';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 100, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (nade.nadeType === 'molotov') {
        // Molotov: projectile, expands into fire
        if (!isEffect) {
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 25, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        if (isEffect) {
            ctx.fillStyle = 'rgba(220, 38, 38, 0.3)';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 38, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (nade.nadeType === 'decoy') {
        // Decoy: projectile, expands into effect
        if (!isEffect) {
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 25, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        if (isEffect) {
            ctx.fillStyle = 'rgba(96, 165, 250, 0.2)';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 50, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawNadeTrajectory(
    ctx: CanvasRenderingContext2D,
    nade: NadeEvent,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    alpha: number = 1.0
): void {
    if (!nade.trajectory || nade.trajectory.length < 2) return;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    
    const firstPoint = nade.trajectory[0];
    const firstPos = worldToCanvas(firstPoint.x, firstPoint.y, mapMetadata, canvasSize, 0, 0, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY);
    ctx.moveTo(firstPos.x, firstPos.y);
    
    for (let i = 1; i < nade.trajectory.length; i++) {
        const point = nade.trajectory[i];
        const pos = worldToCanvas(point.x, point.y, mapMetadata, canvasSize, 0, 0, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY);
        ctx.lineTo(pos.x, pos.y);
    }
    
    const color = nade.nadeType === 'smoke' ? '#9ca3af' : nade.nadeType === 'hegrenade' ? '#f97316' : nade.nadeType === 'flashbang' ? '#fde047' : nade.nadeType === 'molotov' ? '#dc2626' : '#60a5fa';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
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
        ctx.scale(dpr, dpr);
    }

    return { width, height };
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

function getActiveNades(tick: number): NadeEvent[] {
    if (!replayData?.nades) return [];
    return replayData.nades.filter(n => {
        const detTick = n.detonationTick ?? -1;
        const fadeTick = n.fadeTick ?? -1;
        return detTick > 0 && fadeTick > 0 && detTick <= tick && tick <= fadeTick;
    });
}

function drawNadeTrajectoryFading(
    nade: NadeEvent,
    canvasSize: { width: number; height: number },
    tick: number
): void {
    if (!nade.trajectory || nade.trajectory.length < 2) return;
    if (nade.tick > tick) return;

    const ticksSinceThrow = tick - nade.tick;
    const alpha = Math.max(0, 1 - ticksSinceThrow / TRAJECTORY_FADE_DURATION);
    if (alpha <= 0) return;

    drawNadeTrajectory(ctx!, nade, mapMetadata, canvasSize, alpha);
}

function render() {
    if (!browser || !ctx || !container || !replayData) return;

    const tick = Math.floor(getPlaybackTick());
    const canvasSize = {
        width: container.clientWidth,
        height: container.clientHeight,
    };

    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    const roundRange = getCurrentRoundRange(tick);
    const activeNades = getActiveNades(tick);

    // Draw nade trajectories with fade (only within current round)
    for (const nade of replayData.nades) {
        if (roundRange && (nade.tick < roundRange.startTick || nade.tick > roundRange.endTick)) continue;
        drawNadeTrajectoryFading(nade, canvasSize, tick);
    }

    // Draw nade effect zones for active nades (only within current round)
    for (const nade of activeNades) {
        if (roundRange && (nade.tick < roundRange.startTick || nade.tick > roundRange.endTick)) continue;
        drawNade(ctx, nade, mapMetadata, canvasSize, tick, true);
    }
}

onMount(() => {
    if (!browser) return;

    if (container) {
        ctx = container.getContext('2d')!;
        resizeCanvas(container);
    }

    if (replayData) {
        render();
    }

    window.addEventListener('resize', handleResize);
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
    void replayData, mapMetadata, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY;
    if (replayData && ctx) {
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

onDestroy(() => {
    if (browser) {
        window.removeEventListener('resize', handleResize);
    }
    if (resizeTimeout) clearTimeout(resizeTimeout);
    if (rafId !== null) cancelAnimationFrame(rafId);
    stopRenderLoop();
    unsubscribeTick?.();
});
</script>

<style>
.nade-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
    border-radius: 8px;
}

.nade-layer.canvas {
    image-rendering: pixelated;
    image-rendering: -webkit-crisp-edges;
    image-rendering: -moz-crisp-edges;
}
</style>

<canvas 
    bind:this={container}
    class="nade-layer canvas"
    style="width: 100%; height: 100%;"
></canvas>
