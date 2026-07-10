<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';

export let isDrawingEnabled = false;
export let drawingColor = '#22c55e';
export let strokeWidth = 4;
export let clearSignal = 0;

type DrawingPoint = {
    x: number;
    y: number;
};

type DrawingStroke = {
    color: string;
    width: number;
    points: DrawingPoint[];
};

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let strokes: DrawingStroke[] = [];
let activeStroke: DrawingStroke | null = null;
let lastClearSignal = clearSignal;
let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

function clampStrokeWidth(value: number): number {
    return Math.max(1, Math.min(10, Number(value) || 1));
}

function getCanvasSize(): { width: number; height: number } {
    return {
        width: canvas?.clientWidth ?? 0,
        height: canvas?.clientHeight ?? 0,
    };
}

function resizeCanvas(): void {
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(canvas.clientWidth * dpr);
    const height = Math.floor(canvas.clientHeight * dpr);

    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
}

function drawStroke(context: CanvasRenderingContext2D, stroke: DrawingStroke): void {
    if (stroke.points.length === 0) return;

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width;

    if (stroke.points.length === 1) {
        const point = stroke.points[0];
        context.beginPath();
        context.arc(point.x, point.y, stroke.width / 2, 0, Math.PI * 2);
        context.fill();
        context.restore();
        return;
    }

    context.beginPath();
    context.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i += 1) {
        context.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    context.stroke();
    context.restore();
}

function render(): void {
    if (!ctx) return;

    const size = getCanvasSize();
    ctx.clearRect(0, 0, size.width, size.height);
    for (const stroke of strokes) {
        drawStroke(ctx, stroke);
    }
}

function getCanvasPoint(event: PointerEvent): DrawingPoint | null {
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    return {
        x: (event.clientX - rect.left) * (canvas.clientWidth / rect.width),
        y: (event.clientY - rect.top) * (canvas.clientHeight / rect.height),
    };
}

function startStroke(event: PointerEvent): void {
    if (!isDrawingEnabled || event.button !== 0) return;

    const point = getCanvasPoint(event);
    if (!point || !canvas) return;

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    activeStroke = {
        color: drawingColor,
        width: clampStrokeWidth(strokeWidth),
        points: [point],
    };
    strokes.push(activeStroke);
    render();
}

function extendStroke(event: PointerEvent): void {
    if (!activeStroke) return;

    const point = getCanvasPoint(event);
    if (!point) return;

    event.preventDefault();
    activeStroke.points.push(point);
    render();
}

function finishStroke(event: PointerEvent): void {
    if (!activeStroke) return;

    event.preventDefault();
    activeStroke = null;
    if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }
}

function clearDrawings(): void {
    activeStroke = null;
    strokes = [];
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
});

$: {
    void clearSignal;
    if (clearSignal !== lastClearSignal) {
        lastClearSignal = clearSignal;
        clearDrawings();
    }
}

$: {
    void isDrawingEnabled;
    if (!isDrawingEnabled) {
        activeStroke = null;
    }
}

onDestroy(() => {
    if (browser) {
        window.removeEventListener('resize', handleResize);
    }
    if (resizeTimeout) clearTimeout(resizeTimeout);
});
</script>

<style>
.drawing-layer {
    position: absolute;
    inset: 0;
    z-index: 90;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 8px;
    background: transparent;
    cursor: default;
    pointer-events: none;
    touch-action: none;
    transform: var(--replay-viewport-transform, none);
    transform-origin: 0 0;
    will-change: transform;
}

.drawing-layer.active {
    cursor: crosshair;
    pointer-events: auto;
}
</style>

<canvas
    bind:this={canvas}
    class="drawing-layer"
    class:active={isDrawingEnabled}
    onpointerdown={startStroke}
    onpointermove={extendStroke}
    onpointerup={finishStroke}
    onpointercancel={finishStroke}
></canvas>
