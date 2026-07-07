<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { worldToCanvas } from '$lib/canvas/transforms';
import type { ReplayData, KillEvent, MapData as MapMetadata } from '$lib/types/replay/replay_pb';

export let replayData: ReplayData | null = null;
export let mapMetadata: MapMetadata;
export let currentTick: number = 0;
export let imgOffsetX: number = 0;
export let imgOffsetY: number = 0;
export let imgScaleX: number = 1;
export let imgScaleY: number = 1;

let container: HTMLElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

function getCurrentRoundRange(): { startTick: number; endTick: number } | null {
    if (!replayData?.rounds || replayData.rounds.length === 0) return null;
    for (const round of replayData.rounds) {
        if (currentTick >= round.startTick && currentTick <= round.endTick) {
            return { startTick: round.startTick, endTick: round.endTick };
        }
    }
    return null;
}

function getKillsInCurrentRound(): KillEvent[] {
    if (!replayData?.kills) return [];
    const roundRange = getCurrentRoundRange();
    if (!roundRange) return [];
    return replayData.kills.filter(k =>
        k.tick >= roundRange.startTick && k.tick <= roundRange.endTick
    );
}

function getRecentKills(): KillEvent[] {
    const roundKills = getKillsInCurrentRound();
    return roundKills.filter(k =>
        k.tick >= currentTick - 64 && k.tick <= currentTick
    );
}

function drawDeathMarker(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number
): void {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 8);
    ctx.lineTo(x + 8, y + 8);
    ctx.moveTo(x + 8, y - 8);
    ctx.lineTo(x - 8, y + 8);
    ctx.stroke();
}

function drawKillFeed(
    ctx: CanvasRenderingContext2D,
    kills: KillEvent[],
    canvasSize: { width: number; height: number }
): void {
    const maxLines = 5;
    const recentKills = kills.slice(-maxLines);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    let y = canvasSize.height - 80;
    for (const kill of recentKills) {
        const killer = replayData?.players?.find(p => p.steamId === kill.killerSteamId);
        const victim = replayData?.players?.find(p => p.steamId === kill.victimSteamId);
        const killerName = killer?.name || 'BOT';
        const victimName = victim?.name || 'BOT';
        const hs = kill.isHeadshot ? ' (HS)' : '';
        const line = `${killerName} [${kill.weapon}${hs}] ${victimName}`;
        ctx.fillText(line, 16, y);
        y -= 24;
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
    if (!mapMetadata) return;

    const canvasSize = {
        width: container.clientWidth,
        height: container.clientHeight,
    };

    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    const recentKills = getRecentKills();

    for (const kill of recentKills) {
        const pos = worldToCanvas(kill.victimX, kill.victimY, mapMetadata, canvasSize, 0, 0, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY);
        drawDeathMarker(ctx, pos.x, pos.y);
    }

    drawKillFeed(ctx, getKillsInCurrentRound(), canvasSize);
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
});

$: {
    void currentTick, mapMetadata, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY;
    if (replayData && ctx && mapMetadata) {
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

onDestroy(() => {
    if (browser) {
        window.removeEventListener('resize', handleResize);
    }
    if (resizeTimeout) clearTimeout(resizeTimeout);
});
</script>

<style>
.kill-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
    border-radius: 8px;
    pointer-events: none;
}

.kill-layer.canvas {
    image-rendering: pixelated;
    image-rendering: -webkit-crisp-edges;
    image-rendering: -moz-crisp-edges;
}
</style>

<canvas
    bind:this={container}
    class="kill-layer canvas"
    style="width: 100%; height: 100%;"
></canvas>
