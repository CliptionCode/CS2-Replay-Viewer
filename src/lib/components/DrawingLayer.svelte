<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';

export let isShiftDrawingActive = false;
export let leftDrawingColor = '#3b82f6';
export let rightDrawingColor = '#f97316';
export let strokeWidth = 4;
export let clearSignal = 0;
export let drawingMode: 'permanent' | 'fade' = 'permanent';
export let fadeSeconds = 3;

type DrawingPoint = {
    x: number;
    y: number;
};

type DrawingStroke = {
    color: string;
    width: number;
    points: DrawingPoint[];
    completedAt: number;
    fadeDurationMs: number | null;
};

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let strokes: DrawingStroke[] = [];
let activeStroke: DrawingStroke | null = null;
let activePointerId: number | null = null;
let lastClearSignal = clearSignal;
let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
let fadeRafId: number | null = null;

function clampStrokeWidth(value: number): number {
    return Math.max(1, Math.min(10, Number(value) || 1));
}

function clampFadeSeconds(value: number): number {
    return Math.max(1, Math.min(6, Number(value) || 1));
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

function drawStroke(context: CanvasRenderingContext2D, stroke: DrawingStroke, opacity: number): void {
    if (stroke.points.length === 0) return;

    context.save();
    context.globalAlpha = opacity;
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

function scheduleFadeRender(): void {
    if (fadeRafId !== null) return;
    fadeRafId = requestAnimationFrame(timestamp => {
        fadeRafId = null;
        render(timestamp);
    });
}

function render(timestamp = performance.now()): void {
    if (!ctx) return;

    const size = getCanvasSize();
    ctx.clearRect(0, 0, size.width, size.height);
    let hasFadingStroke = false;
    strokes = strokes.filter(stroke => {
        if (stroke === activeStroke || stroke.fadeDurationMs === null) return true;
        return timestamp - stroke.completedAt < stroke.fadeDurationMs;
    });
    for (const stroke of strokes) {
        const opacity = stroke === activeStroke || stroke.fadeDurationMs === null
            ? 1
            : Math.max(0, 1 - (timestamp - stroke.completedAt) / stroke.fadeDurationMs);
        drawStroke(ctx, stroke, opacity);
        if (stroke !== activeStroke && stroke.fadeDurationMs !== null && opacity > 0) {
            hasFadingStroke = true;
        }
    }
    if (hasFadingStroke) scheduleFadeRender();
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
    if (!isShiftDrawingActive || !event.shiftKey || (event.button !== 0 && event.button !== 2)) return;

    const point = getCanvasPoint(event);
    if (!point || !canvas) return;

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    activePointerId = event.pointerId;
    activeStroke = {
        color: event.button === 2 ? rightDrawingColor : leftDrawingColor,
        width: clampStrokeWidth(strokeWidth),
        points: [point],
        completedAt: performance.now(),
        fadeDurationMs: drawingMode === 'fade' ? clampFadeSeconds(fadeSeconds) * 1000 : null,
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

function completeActiveStroke(): void {
    if (!activeStroke) return;
    activeStroke.completedAt = performance.now();
    activeStroke = null;
    render();
}

function finishStroke(event: PointerEvent): void {
    if (!activeStroke || event.pointerId !== activePointerId) return;

    event.preventDefault();
    completeActiveStroke();
    activePointerId = null;
    if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }
}

function handleContextMenu(event: MouseEvent): void {
    if (isShiftDrawingActive || event.shiftKey) event.preventDefault();
}

function clearDrawings(): void {
    if (canvas && activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
        canvas.releasePointerCapture(activePointerId);
    }
    activeStroke = null;
    activePointerId = null;
    strokes = [];
    if (fadeRafId !== null) {
        cancelAnimationFrame(fadeRafId);
        fadeRafId = null;
    }
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
    void isShiftDrawingActive;
    if (!isShiftDrawingActive) {
        completeActiveStroke();
        if (canvas && activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
            canvas.releasePointerCapture(activePointerId);
        }
        activePointerId = null;
    }
}

onDestroy(() => {
    if (browser) {
        window.removeEventListener('resize', handleResize);
    }
    if (resizeTimeout) clearTimeout(resizeTimeout);
    if (fadeRafId !== null) cancelAnimationFrame(fadeRafId);
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
    class:active={isShiftDrawingActive}
    onpointerdown={startStroke}
    onpointermove={extendStroke}
    onpointerup={finishStroke}
    onpointercancel={finishStroke}
    oncontextmenu={handleContextMenu}
></canvas>
