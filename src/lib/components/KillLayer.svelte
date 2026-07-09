<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { worldToCanvas } from '$lib/canvas/transforms';
import { getPlaybackTick, subscribePlaybackTick } from '$lib/playback-state';
import { getRoundDisplayEndTick } from '$lib/replay/rounds';
import type { ReplayData, KillEvent, MapData as MapMetadata } from '$lib/types/replay/replay_pb';

export let replayData: ReplayData | null = null;
export let mapMetadata: MapMetadata;
export let isPlaying: boolean = false;
export let feedLeftOffset = 16;
export let onselectkillfeed: (kill: KillEvent) => void = () => {};

let markerCanvas: HTMLCanvasElement | null = null;
let feedCanvas: HTMLCanvasElement | null = null;
let markerCtx: CanvasRenderingContext2D | null = null;
let feedCtx: CanvasRenderingContext2D | null = null;
let unsubscribeTick: (() => void) | null = null;

type KillFeedHitbox = {
    kill: KillEvent;
    x: number;
    y: number;
    width: number;
    height: number;
};

let killFeedHitboxes: KillFeedHitbox[] = [];

function getCurrentRoundRange(tick: number): { startTick: number; endTick: number } | null {
    if (!replayData?.rounds || replayData.rounds.length === 0) return null;
    for (const round of replayData.rounds) {
        const displayEndTick = getRoundDisplayEndTick(replayData, round);
        if (tick >= round.startTick && tick <= displayEndTick) {
            return { startTick: round.startTick, endTick: displayEndTick };
        }
    }
    return null;
}

function getKillsInCurrentRound(tick: number): KillEvent[] {
    if (!replayData?.kills) return [];
    const roundRange = getCurrentRoundRange(tick);
    if (!roundRange) return [];
    return replayData.kills.filter(k =>
        k.tick >= roundRange.startTick && k.tick <= roundRange.endTick
    );
}

function getKillFeedKills(tick: number): KillEvent[] {
    return getKillsInCurrentRound(tick).filter(k => k.tick <= tick);
}

function getRecentKills(tick: number): KillEvent[] {
    const roundKills = getKillsInCurrentRound(tick);
    return roundKills.filter(k =>
        k.tick >= tick - 64 && k.tick <= tick
    );
}

function getPlayerTeam(steamId: bigint, tick: number): number {
    if (!replayData?.players || steamId === 0n) return 0;

    const player = replayData.players.find(p => p.steamId === steamId);
    if (!player) return 0;

    const roundRange = getCurrentRoundRange(tick);
    if (roundRange) {
        const round = replayData.rounds.find(r => r.startTick === roundRange.startTick && r.endTick === roundRange.endTick);
        if (round) {
            const halfSize = round.roundNumber <= 24 ? 12 : 3;
            const halfIndex = Math.floor((round.roundNumber - 1) / halfSize);
            const isOddHalf = halfIndex % 2 === 0;
            if (isOddHalf) {
                if (player.team === 2) return 3;
                if (player.team === 3) return 2;
            }
        }
    }

    return player.team;
}

function getTeamColor(team: number): string {
    if (team === 2) return '#f97316';
    if (team === 3) return '#3b82f6';
    return '#e2e8f0';
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
    canvasSize: { width: number; height: number },
    tick: number
): void {
    const maxLines = 5;
    const recentKills = kills.slice(-maxLines);

    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    let y = canvasSize.height - 80;
    killFeedHitboxes = [];
    for (const kill of recentKills) {
        const killer = replayData?.players?.find(p => p.steamId === kill.killerSteamId);
        const victim = replayData?.players?.find(p => p.steamId === kill.victimSteamId);
        const killerName = killer?.name || 'BOT';
        const victimName = victim?.name || 'BOT';
        const hs = kill.isHeadshot ? ' (HS)' : '';
        const killerColor = getTeamColor(getPlayerTeam(kill.killerSteamId, tick));
        const victimColor = getTeamColor(getPlayerTeam(kill.victimSteamId, tick));

        let x = feedLeftOffset;
        let rowWidth = 0;
        const segments = [
            { text: killerName, color: killerColor },
            { text: ` [${kill.weapon}${hs}] `, color: '#e2e8f0' },
            { text: victimName, color: victimColor },
        ];

        for (const segment of segments) {
            ctx.fillStyle = segment.color;
            ctx.fillText(segment.text, x, y);
            const segmentWidth = ctx.measureText(segment.text).width;
            x += segmentWidth;
            rowWidth += segmentWidth;
        }
        killFeedHitboxes.push({
            kill,
            x: feedLeftOffset - 4,
            y: y - 18,
            width: rowWidth + 8,
            height: 22,
        });
        y -= 24;
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

function resizeCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D | null): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    if (!context) return;

    context.canvas.width = width;
    context.canvas.height = height;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeCanvases(): void {
    if (markerCanvas) resizeCanvas(markerCanvas, markerCtx);
    if (feedCanvas) resizeCanvas(feedCanvas, feedCtx);
}

function getCanvasSize(): { width: number; height: number } | null {
    const canvas = markerCanvas ?? feedCanvas;
    if (!canvas) return null;
    return {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
    };
}

function render() {
    if (!browser || !replayData) return;
    if (!mapMetadata) return;

    const tick = Math.floor(getPlaybackTick());
    const canvasSize = getCanvasSize();
    if (!canvasSize) return;

    if (markerCtx) {
        markerCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
        for (const kill of getRecentKills(tick)) {
            const pos = worldToCanvas(kill.victimX, kill.victimY, mapMetadata, canvasSize);
            drawDeathMarker(markerCtx, pos.x, pos.y);
        }
    }

    if (feedCtx) {
        feedCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
        drawKillFeed(feedCtx, getKillFeedKills(tick), canvasSize, tick);
    } else {
        killFeedHitboxes = [];
    }
}

onMount(() => {
    if (!browser) return;

    markerCtx = markerCanvas?.getContext('2d') ?? null;
    feedCtx = feedCanvas?.getContext('2d') ?? null;
    resizeCanvases();

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
    void replayData, mapMetadata;
    if (replayData && (markerCtx || feedCtx) && mapMetadata) {
        scheduleRender();
    }
}

let resizeTimeout: ReturnType<typeof setTimeout>;
function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        resizeCanvases();
        render();
    }, 150);
}

function getCanvasPoint(event: MouseEvent): { x: number; y: number } | null {
    if (!feedCanvas) return null;
    const rect = feedCanvas.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
    };
}

function getKillFeedHitboxAt(event: MouseEvent): KillFeedHitbox | null {
    const point = getCanvasPoint(event);
    if (!point) return null;
    return killFeedHitboxes.find(hitbox =>
        point.x >= hitbox.x &&
        point.x <= hitbox.x + hitbox.width &&
        point.y >= hitbox.y &&
        point.y <= hitbox.y + hitbox.height
    ) ?? null;
}

function handleClick(event: MouseEvent): void {
    const hitbox = getKillFeedHitboxAt(event);
    if (!hitbox) return;
    event.preventDefault();
    onselectkillfeed(hitbox.kill);
}

function handleMouseMove(event: MouseEvent): void {
    if (!feedCanvas) return;
    feedCanvas.style.cursor = getKillFeedHitboxAt(event) ? 'pointer' : 'default';
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
.kill-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
    border-radius: 8px;
}

.kill-layer.canvas {
    image-rendering: pixelated;
    image-rendering: -webkit-crisp-edges;
    image-rendering: -moz-crisp-edges;
}

.kill-marker-layer {
    pointer-events: none;
    transform: var(--replay-viewport-transform, none);
    transform-origin: 0 0;
    will-change: transform;
}

.kill-feed-layer {
    pointer-events: auto;
}
</style>

<canvas
    bind:this={markerCanvas}
    class="kill-layer kill-marker-layer canvas"
    style="width: 100%; height: 100%;"
></canvas>

<canvas
    bind:this={feedCanvas}
    class="kill-layer kill-feed-layer canvas"
    style="width: 100%; height: 100%;"
    onclick={handleClick}
    onmousemove={handleMouseMove}
></canvas>
