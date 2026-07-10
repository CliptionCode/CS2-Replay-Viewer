<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { browser } from '$app/environment';
import { worldToCanvas } from '$lib/canvas/transforms';
import { getWeaponIconPath } from '$lib/equipment-icons';
import { getPlaybackTick, subscribePlaybackTick } from '$lib/playback-state';
import type { DroppedEquipment, MapData as MapMetadata, ReplayData } from '$lib/types/replay/replay_pb';

export let replayData: ReplayData | null = null;
export let mapMetadata: MapMetadata;
export let isPlaying = false;
export let showDroppedWeapons = true;
export let showDroppedUtility = true;
export let showDroppedC4 = true;

const ICON_SIZE = 18;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let rafId: number | null = null;
let renderLoopId: number | null = null;
let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
let unsubscribeTick: (() => void) | null = null;
const iconCache = new Map<string, HTMLImageElement>();

function getIcon(item: DroppedEquipment): HTMLImageElement | null {
    const path = getWeaponIconPath(item.equipmentName);
    const cached = iconCache.get(path);
    if (cached) return cached;
    if (!browser) return null;

    const image = new Image();
    image.decoding = 'async';
    image.onload = scheduleRender;
    image.onerror = scheduleRender;
    image.src = path;
    iconCache.set(path, image);
    return image;
}

function isVisible(item: DroppedEquipment, tick: number): boolean {
    if (item.startTick > tick || item.endTick < tick) return false;
    if (item.category === 'weapon') return showDroppedWeapons;
    if (item.category === 'utility') return showDroppedUtility;
    if (item.category === 'c4') return showDroppedC4;
    return false;
}

function drawItem(item: DroppedEquipment, canvasSize: { width: number; height: number }): void {
    if (!ctx) return;
    const image = getIcon(item);
    if (!image?.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;

    const position = worldToCanvas(item.x, item.y, mapMetadata, canvasSize);
    const scale = Math.min(ICON_SIZE / image.naturalWidth, ICON_SIZE / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 5;
    ctx.drawImage(image, position.x - width / 2, position.y - height / 2, width, height);
    ctx.restore();
}

function render(): void {
    if (!browser || !ctx || !canvas || !replayData) return;

    const canvasSize = { width: canvas.clientWidth, height: canvas.clientHeight };
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    const tick = Math.floor(getPlaybackTick());
    for (const item of replayData.droppedEquipment ?? []) {
        if (isVisible(item, tick)) drawItem(item, canvasSize);
    }
}

function scheduleRender(): void {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
        rafId = null;
        render();
    });
}

function startRenderLoop(): void {
    if (renderLoopId !== null) return;
    const loop = () => {
        render();
        renderLoopId = requestAnimationFrame(loop);
    };
    renderLoopId = requestAnimationFrame(loop);
}

function stopRenderLoop(): void {
    if (renderLoopId === null) return;
    cancelAnimationFrame(renderLoopId);
    renderLoopId = null;
}

function resizeCanvas(): void {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
}

function handleResize(): void {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resizeCanvas, 150);
}

onMount(() => {
    if (!browser || !canvas) return;
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', handleResize);
    unsubscribeTick = subscribePlaybackTick(scheduleRender);
});

$: {
    void isPlaying;
    if (browser) {
        if (isPlaying) startRenderLoop();
        else {
            stopRenderLoop();
            scheduleRender();
        }
    }
}

$: {
    void replayData, mapMetadata, showDroppedWeapons, showDroppedUtility, showDroppedC4;
    if (browser && ctx) scheduleRender();
}

onDestroy(() => {
    if (browser) window.removeEventListener('resize', handleResize);
    if (resizeTimeout) clearTimeout(resizeTimeout);
    if (rafId !== null) cancelAnimationFrame(rafId);
    stopRenderLoop();
    unsubscribeTick?.();
});
</script>

<style>
.dropped-equipment-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    pointer-events: none;
    transform: var(--replay-viewport-transform, none);
    transform-origin: 0 0;
    will-change: transform;
}
</style>

<canvas bind:this={canvas} class="dropped-equipment-layer"></canvas>
