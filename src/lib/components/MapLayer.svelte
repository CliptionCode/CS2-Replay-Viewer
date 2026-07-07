<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { worldToCanvas } from '$lib/canvas/transforms';
import type { MapData as MapMetadata, ReplayData } from '$lib/types/replay/replay_pb';

export let mapMetadata: MapMetadata;
export let replayData: ReplayData | null = null;
export let imgOffsetX: number = 0;
export let imgOffsetY: number = 0;
export let imgScaleX: number = 1;
export let imgScaleY: number = 1;

let container: HTMLElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let mapImage: HTMLImageElement | null = null;

const MAP_ICONS_PATH = '/maps';

function getMapMetadata(): MapMetadata {
    return mapMetadata;
}

function loadMapImage(mapName: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load map image: ${mapName}`));
        image.src = `${MAP_ICONS_PATH}/${mapName}.png`;
    });
}

function calculateMapCanvasSize(
    mapWidth: number,
    mapHeight: number,
    maxWidth: number,
    maxHeight: number
): { width: number; height: number; scale: number } {
    const widthScale = maxWidth / mapWidth;
    const heightScale = maxHeight / mapHeight;
    const scale = Math.min(widthScale, heightScale);

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
    centerX: number,
    centerY: number
): void {
    // Draw map image (placeholder for now - in v2 load actual PNG)
    ctx.fillStyle = '#1e1e28';
    ctx.fillRect(0, 0, mapWidth, mapHeight);

    // Draw border
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, mapWidth, mapHeight);

    // Draw center point
    ctx.fillStyle = '#e53e3e';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw coordinate labels
    ctx.fillStyle = '#718096';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // North indicator
    ctx.fillText('N', centerX, 10);
    // East indicator  
    ctx.fillText('E', mapWidth - 10, centerY);
    // South indicator
    ctx.fillText('S', centerX, mapHeight - 10);
    // West indicator
    ctx.fillText('W', 10, centerY);

    // Draw coordinate grid for reference
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 1;
    const gridSize = Math.min(mapWidth, mapHeight) / 10;

    // Horizontal grid lines
    for (let y = 0; y <= mapHeight; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(mapWidth, y);
        ctx.stroke();
    }

    // Vertical grid lines  
    for (let x = 0; x <= mapWidth; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, mapHeight);
        ctx.stroke();
    }
}

function drawMapGrid(
    ctx: CanvasRenderingContext2D,
    mapWidth: number,
    mapHeight: number
): void {
    // Draw map name
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MAP NAME', mapWidth / 2, 30);

    // Draw scale indicator
    ctx.fillStyle = '#a0aec0';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText('Scale: 1 : 4.4', mapWidth / 2, 50);
}

function drawMapImage(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    mapWidth: number,
    mapHeight: number,
    centerX: number,
    centerY: number
): void {
    // Draw map image with transparency and alignment adjustments
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.drawImage(
        image,
        centerX + imgOffsetX,
        centerY + imgOffsetY,
        mapWidth * imgScaleX,
        mapHeight * imgScaleY
    );
    ctx.restore();
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

onMount(() => {
    if (!browser) return;

    if (container) {
        ctx = container.getContext('2d')!;
        const { width, height } = resizeCanvas(container);
        container.width = width;
        container.height = height;
    }

    // Load map image
    if (mapMetadata?.name) {
        loadMapImage(mapMetadata.name)
            .then(loadedImage => {
                mapImage = loadedImage;
                render();
            })
            .catch(err => {
                console.error('Failed to load map image:', err);
            });
    }

    window.addEventListener('resize', handleResize);
});

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

    drawMapBackground(ctx, mapCanvasSize.width, mapCanvasSize.height, centerX, centerY);
    drawMapGrid(ctx, mapCanvasSize.width, mapCanvasSize.height);

    // If map image is loaded, draw it
    if (mapImage && mapImage.complete) {
        drawMapImage(ctx, mapImage, mapCanvasSize.width, mapCanvasSize.height, centerX, centerY);
    }
}

$: {
    void replayData, imgOffsetX, imgOffsetY, imgScaleX, imgScaleY;
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
