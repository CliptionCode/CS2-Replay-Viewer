<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { MAP_CANVAS_MARGIN } from '$lib/canvas/transforms';
import { getRadarInfo } from '$lib/maps/radar-info';
import type { MapData as MapMetadata, ReplayData } from '$lib/types/replay/replay_pb';

export let mapMetadata: MapMetadata;
export let replayData: ReplayData | null = null;
export let mapVariant: 'default' | 'lower' = 'default';
export let onmapready: (ready: boolean) => void = () => {};

let container: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let mapImage: HTMLImageElement | null = null;
let loadedMapName = '';
let mapLoadId = 0;

function getMapMetadata(): MapMetadata {
    return mapMetadata;
}

function loadMapImage(mapName: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const imagePath = getMapImagePath(mapName, mapVariant);
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load map image: ${mapName}`));
        image.src = imagePath;
    });
}

function getMapImagePath(mapName: string, variant: 'default' | 'lower'): string {
    const radarInfo = getRadarInfo(mapName);
    if (variant === 'lower' && radarInfo?.verticalSections?.lower) {
        return radarInfo.verticalSections.lower.imagePath;
    }
    return radarInfo?.imagePath ?? `/maps/${mapName}.png`;
}

function calculateMapCanvasSize(
    mapWidth: number,
    mapHeight: number,
    maxWidth: number,
    maxHeight: number
): { width: number; height: number; scale: number } {
    const widthScale = maxWidth / mapWidth;
    const heightScale = maxHeight / mapHeight;
    const scale = Math.min(widthScale, heightScale) * MAP_CANVAS_MARGIN;

    return {
        width: mapWidth * scale,
        height: mapHeight * scale,
        scale,
    };
}

function drawMapBackground(
    ctx: CanvasRenderingContext2D,
    mapWidth: number,
    mapHeight: number,
    originX: number,
    originY: number
): void {
    // Draw map image (placeholder for now - in v2 load actual PNG)
    ctx.fillStyle = '#1e1e28';
    ctx.fillRect(originX, originY, mapWidth, mapHeight);

    // Draw border
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 2;
    ctx.strokeRect(originX, originY, mapWidth, mapHeight);

    // Draw center point
    ctx.fillStyle = '#e53e3e';
    ctx.beginPath();
    ctx.arc(originX + mapWidth / 2, originY + mapHeight / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw coordinate labels
    ctx.fillStyle = '#718096';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // North indicator
    ctx.fillText('N', originX + mapWidth / 2, originY + 10);
    // East indicator  
    ctx.fillText('E', originX + mapWidth - 10, originY + mapHeight / 2);
    // South indicator
    ctx.fillText('S', originX + mapWidth / 2, originY + mapHeight - 10);
    // West indicator
    ctx.fillText('W', originX + 10, originY + mapHeight / 2);

    // Draw coordinate grid for reference
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 1;
    const gridSize = Math.min(mapWidth, mapHeight) / 10;

    // Horizontal grid lines
    for (let y = 0; y <= mapHeight; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(originX, originY + y);
        ctx.lineTo(originX + mapWidth, originY + y);
        ctx.stroke();
    }

    // Vertical grid lines  
    for (let x = 0; x <= mapWidth; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(originX + x, originY);
        ctx.lineTo(originX + x, originY + mapHeight);
        ctx.stroke();
    }
}

function drawMapImage(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    mapWidth: number,
    mapHeight: number,
    originX: number,
    originY: number
): void {
    ctx.drawImage(image, originX, originY, mapWidth, mapHeight);
}

function resizeCanvas(container: HTMLCanvasElement): { width: number; height: number } {
    const dpr = window.devicePixelRatio || 1;

    const width = Math.floor(container.clientWidth * dpr);
    const height = Math.floor(container.clientHeight * dpr);

    if (ctx) {
        ctx.canvas.width = width;
        ctx.canvas.height = height;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    return { width, height };
}

onMount(() => {
    if (!browser) return;

    if (container) {
        ctx = container.getContext('2d')!;
        const { width, height } = resizeCanvas(container);
        container.width = width;
        container.height = height;
    }

    window.addEventListener('resize', handleResize);
    render();
});

function loadCurrentMapImage(mapName: string): void {
    const radarInfo = getRadarInfo(mapName);
    const nextMapName = radarInfo?.name ?? mapName;
    const requestId = ++mapLoadId;

    loadedMapName = `${nextMapName}:${mapVariant}`;
    mapImage = null;
    onmapready(false);
    render();

    loadMapImage(nextMapName)
        .then(loadedImage => {
            if (requestId !== mapLoadId) return;
            mapImage = loadedImage;
            render();
            onmapready(true);
        })
        .catch(err => {
            if (requestId !== mapLoadId) return;
            console.error('Failed to load map image:', err);
            render();
            onmapready(true);
        });
}

function render() {
    if (!browser || !ctx || !container) return;

    const currentMap = getMapMetadata();
    const canvasSize = {
        width: container.clientWidth,
        height: container.clientHeight,
    };

    const mapCanvasSize = calculateMapCanvasSize(
        currentMap.width || 1024,
        currentMap.height || 1024,
        canvasSize.width,
        canvasSize.height
    );

    // Clear canvas
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    // Draw centered map
    const centerX = (canvasSize.width - mapCanvasSize.width) / 2;
    const centerY = (canvasSize.height - mapCanvasSize.height) / 2;

    if (mapImage && mapImage.complete) {
        drawMapImage(ctx, mapImage, mapCanvasSize.width, mapCanvasSize.height, centerX, centerY);
    } else {
        drawMapBackground(ctx, mapCanvasSize.width, mapCanvasSize.height, centerX, centerY);
    }
}

$: {
    void mapMetadata, mapVariant;
    const radarInfo = getRadarInfo(mapMetadata?.name);
    const nextMapName = radarInfo?.name ?? mapMetadata?.name ?? '';
    const nextLoadedKey = `${nextMapName}:${mapVariant}`;
    if (browser && nextMapName && nextLoadedKey !== loadedMapName) {
        loadCurrentMapImage(nextMapName);
    }
}

$: {
    void replayData, mapMetadata;
    if (ctx) {
        render();
    }
}

// Handle window resize
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
});
</script>

<style>
.map-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #0f0f13, #1a1a24);
    overflow: hidden;
    border-radius: 8px;
    transform: var(--replay-viewport-transform, none);
    transform-origin: 0 0;
    will-change: transform;
}

.map-layer.canvas {
    image-rendering: pixelated;
    image-rendering: -webkit-crisp-edges;
    image-rendering: -moz-crisp-edges;
}
</style>

<canvas 
    bind:this={container}
    class="map-layer canvas"
    style="width: 100%; height: 100%;"
></canvas>
