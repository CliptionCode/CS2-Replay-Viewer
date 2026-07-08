<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { worldToCanvas } from '$lib/canvas/transforms';
import { getPlaybackTick, subscribePlaybackTick } from '$lib/playback-state';
import type { ReplayData, NadeEvent, NadeTrajectoryPoint, MapData as MapMetadata } from '$lib/types/replay/replay_pb';

export let replayData: ReplayData | null = null;
export let mapMetadata: MapMetadata;
export let isPlaying: boolean = false;

let container: HTMLElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let unsubscribeTick: (() => void) | null = null;

const TRAJECTORY_VISIBLE_TICKS = Math.round(64 * 0.6);
const FALLBACK_FLIGHT_DURATION_TICKS = 96; // Used only when a nade has start/end but no sampled trajectory.
const MIN_FLIGHT_DURATION_TICKS = 24;
const MAX_TRUSTED_RAW_FLIGHT_TICKS = 256;
const MAX_TRUSTED_SMOKE_RAW_FLIGHT_TICKS = 640;
const MATCH_DISTANCE_UNITS = 240;
const MATCH_TICK_WINDOW = 768;
const SMOKE_MATCH_TICK_WINDOW = 1536;

type NadePathPoint = Pick<NadeTrajectoryPoint, 'tick' | 'x' | 'y' | 'z'>;

let matchingEffectCache = new WeakMap<NadeEvent, NadeEvent | null>();

function getNadeColor(nadeType: string): string {
    if (nadeType === 'smoke') return '#9ca3af';
    if (nadeType === 'hegrenade') return '#f97316';
    if (nadeType === 'flashbang') return '#fde047';
    if (nadeType === 'molotov' || nadeType === 'incendiary') return '#dc2626';
    return '#60a5fa';
}

function getNadeEffectFill(nadeType: string): string {
    if (nadeType === 'smoke') return 'rgba(156, 163, 175, 0.35)';
    if (nadeType === 'hegrenade') return 'rgba(249, 115, 22, 0.3)';
    if (nadeType === 'flashbang') return 'rgba(253, 224, 71, 0.2)';
    if (nadeType === 'molotov' || nadeType === 'incendiary') return 'rgba(220, 38, 38, 0.3)';
    return 'rgba(96, 165, 250, 0.2)';
}

function getNadeEffectRadius(nadeType: string): number {
    if (nadeType === 'smoke') return 50;
    if (nadeType === 'hegrenade') return 62;
    if (nadeType === 'flashbang') return 100;
    if (nadeType === 'molotov' || nadeType === 'incendiary') return 38;
    return 50;
}

function getDetonationTick(nade: NadeEvent): number {
    return nade.detonationTick || nade.tick;
}

function hasTrajectory(nade: NadeEvent): boolean {
    return (nade.trajectory?.length ?? 0) >= 2;
}

function getCanonicalDetonationTick(nade: NadeEvent): number {
    return getMatchingEffectEvent(nade)?.detonationTick || getDetonationTick(nade);
}

function getCanonicalFadeTick(nade: NadeEvent): number {
    return getMatchingEffectEvent(nade)?.fadeTick || nade.fadeTick;
}

function getCanonicalEndPoint(nade: NadeEvent): Pick<NadePathPoint, 'x' | 'y' | 'z'> {
    const effect = getMatchingEffectEvent(nade);
    return {
        x: effect?.endX ?? nade.endX,
        y: effect?.endY ?? nade.endY,
        z: effect?.endZ ?? nade.endZ,
    };
}

function hasUsableStartPosition(nade: NadeEvent): boolean {
    return nade.startX !== 0 || nade.startY !== 0 || nade.startZ !== 0;
}

function getTimedTrajectory(nade: NadeEvent): NadePathPoint[] {
    const detonationTick = getCanonicalDetonationTick(nade);
    const endPoint = getCanonicalEndPoint(nade);
    const trajectory = (nade.trajectory ?? []).filter(point =>
        Number.isFinite(point.x) && Number.isFinite(point.y)
    );

    if (trajectory.length >= 2) {
        const spatialPath = compactTrajectoryPath(trajectory, endPoint);
        const firstTick = getFlightStartTick(nade, trajectory, detonationTick);
        return retimePathByDistance(spatialPath, firstTick, detonationTick);
    }

    if (!hasUsableStartPosition(nade) || detonationTick <= 0) return [];

    return [
        {
            tick: Math.max(0, detonationTick - getFallbackFlightDuration(nade.nadeType)),
            x: nade.startX,
            y: nade.startY,
            z: nade.startZ,
        },
        {
            tick: detonationTick,
            x: endPoint.x,
            y: endPoint.y,
            z: endPoint.z,
        },
    ];
}

function getFlightStartTick(nade: NadeEvent, trajectory: NadeTrajectoryPoint[], detonationTick: number): number {
    const rawFirstTick = trajectory[0]?.tick ?? 0;
    const rawDuration = rawFirstTick > 0 && rawFirstTick < detonationTick
        ? detonationTick - rawFirstTick
        : 0;
    const maxTrustedRawFlightTicks = getMaxTrustedRawFlightTicks(nade.nadeType);

    if (rawDuration >= MIN_FLIGHT_DURATION_TICKS && rawDuration <= maxTrustedRawFlightTicks) {
        return rawFirstTick;
    }

    return Math.max(0, detonationTick - getFallbackFlightDuration(nade.nadeType));
}

function getMaxTrustedRawFlightTicks(nadeType: string): number {
    return nadeType === 'smoke' ? MAX_TRUSTED_SMOKE_RAW_FLIGHT_TICKS : MAX_TRUSTED_RAW_FLIGHT_TICKS;
}

function getFallbackFlightDuration(nadeType: string): number {
    if (nadeType === 'smoke' || nadeType === 'molotov' || nadeType === 'incendiary') return 128;
    return FALLBACK_FLIGHT_DURATION_TICKS;
}

function compactTrajectoryPath(
    trajectory: NadeTrajectoryPoint[],
    endPoint: Pick<NadePathPoint, 'x' | 'y' | 'z'>
): NadePathPoint[] {
    const compact: NadePathPoint[] = [];

    for (const point of trajectory) {
        const nextPoint = { tick: 0, x: point.x, y: point.y, z: point.z };
        const lastPoint = compact[compact.length - 1];
        if (!lastPoint || distanceSquared(lastPoint, nextPoint) > 16) {
            compact.push(nextPoint);
        }
    }

    const finalPoint = { tick: 0, x: endPoint.x, y: endPoint.y, z: endPoint.z };
    const lastPoint = compact[compact.length - 1];
    if (!lastPoint) return [finalPoint];

    if (distanceSquared(lastPoint, finalPoint) > 16) {
        compact.push(finalPoint);
    } else {
        compact[compact.length - 1] = finalPoint;
    }

    return compact;
}

function retimePathByDistance(path: NadePathPoint[], startTick: number, endTick: number): NadePathPoint[] {
    if (path.length < 2 || endTick <= startTick) return path;

    const cumulativeDistances: number[] = [0];
    let totalDistance = 0;

    for (let i = 1; i < path.length; i++) {
        totalDistance += Math.sqrt(distanceSquared(path[i - 1], path[i]));
        cumulativeDistances.push(totalDistance);
    }

    const duration = endTick - startTick;
    if (totalDistance <= 0) {
        return path.map((point, index) => ({
            ...point,
            tick: startTick + (duration * index) / Math.max(1, path.length - 1),
        }));
    }

    return path.map((point, index) => ({
        ...point,
        tick: startTick + (duration * cumulativeDistances[index]) / totalDistance,
    }));
}

function distanceSquared(
    a: Pick<NadePathPoint, 'x' | 'y'>,
    b: Pick<NadePathPoint, 'x' | 'y'>
): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function samplePathAtTick(path: NadePathPoint[], tick: number): NadePathPoint | null {
    if (path.length === 0) return null;
    if (tick <= path[0].tick) return path[0];

    for (let i = 1; i < path.length; i++) {
        const previous = path[i - 1];
        const current = path[i];
        if (tick > current.tick) continue;

        if (current.tick <= previous.tick) return current;

        const alpha = (tick - previous.tick) / (current.tick - previous.tick);
        return {
            tick,
            x: previous.x + (current.x - previous.x) * alpha,
            y: previous.y + (current.y - previous.y) * alpha,
            z: previous.z + (current.z - previous.z) * alpha,
        };
    }

    return path[path.length - 1];
}

function getVisibleTrajectory(path: NadePathPoint[], tick: number): { points: NadePathPoint[]; projectile: NadePathPoint | null; alpha: number } {
    if (path.length < 2 || tick < path[0].tick) return { points: [], projectile: null, alpha: 0 };

    const pathEndTick = path[path.length - 1].tick;
    const ticksAfterPathEnd = Math.max(0, tick - pathEndTick);
    if (ticksAfterPathEnd > TRAJECTORY_VISIBLE_TICKS) return { points: [], projectile: null, alpha: 0 };

    const cappedTick = Math.min(tick, pathEndTick);
    const windowStartTick = Math.max(path[0].tick, cappedTick - TRAJECTORY_VISIBLE_TICKS);
    const startPoint = samplePathAtTick(path, windowStartTick);
    const endPoint = samplePathAtTick(path, cappedTick);
    if (!startPoint || !endPoint) return { points: [], projectile: null, alpha: 0 };

    const visible: NadePathPoint[] = [startPoint];

    for (const point of path) {
        if (point.tick > windowStartTick && point.tick < cappedTick) {
            visible.push(point);
        }
    }

    if (endPoint.tick !== startPoint.tick) {
        visible.push(endPoint);
    }

    const fadeAlpha = Math.max(0, 1 - ticksAfterPathEnd / TRAJECTORY_VISIBLE_TICKS);
    return {
        points: visible,
        projectile: endPoint,
        alpha: 0.85 * fadeAlpha,
    };
}

function drawNadeEffect(
    ctx: CanvasRenderingContext2D,
    nade: NadeEvent,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number }
): void {
    const endPoint = getCanonicalEndPoint(nade);
    const pos = worldToCanvas(endPoint.x, endPoint.y, mapMetadata, canvasSize);

    ctx.fillStyle = getNadeEffectFill(nade.nadeType);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, getNadeEffectRadius(nade.nadeType), 0, Math.PI * 2);
    ctx.fill();
}

function drawNadeFlight(
    ctx: CanvasRenderingContext2D,
    nade: NadeEvent,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    tick: number
): void {
    const path = getTimedTrajectory(nade);
    const detonationTick = getCanonicalDetonationTick(nade);
    const { points, projectile, alpha } = getVisibleTrajectory(path, tick);
    if (points.length < 2 || !projectile || alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = getNadeColor(nade.nadeType);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([8, 8]);
    ctx.beginPath();

    const firstPoint = points[0];
    const firstPos = worldToCanvas(firstPoint.x, firstPoint.y, mapMetadata, canvasSize);
    ctx.moveTo(firstPos.x, firstPos.y);

    for (let i = 1; i < points.length; i++) {
        const point = points[i];
        const pos = worldToCanvas(point.x, point.y, mapMetadata, canvasSize);
        ctx.lineTo(pos.x, pos.y);
    }

    ctx.stroke();
    ctx.setLineDash([]);

    if (tick < detonationTick) {
        const projectilePos = worldToCanvas(projectile.x, projectile.y, mapMetadata, canvasSize);
        ctx.globalAlpha = 1;
        ctx.fillStyle = getNadeColor(nade.nadeType);
        ctx.beginPath();
        ctx.arc(projectilePos.x, projectilePos.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

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
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
        const detTick = getCanonicalDetonationTick(n);
        const fadeTick = getCanonicalFadeTick(n);
        return detTick > 0 && fadeTick > 0 && detTick <= tick && tick <= fadeTick && !isTrajectoryEffectDuplicate(n);
    });
}

function isTrajectoryEffectDuplicate(nade: NadeEvent): boolean {
    return hasTrajectory(nade) && getMatchingEffectEvent(nade) !== null;
}

function getMatchingEffectEvent(nade: NadeEvent): NadeEvent | null {
    if (!hasTrajectory(nade) || !replayData?.nades) return null;
    const cached = matchingEffectCache.get(nade);
    if (cached !== undefined) return cached;

    let bestMatch: NadeEvent | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of replayData.nades) {
        if (candidate === nade || hasTrajectory(candidate) || !isMatchingNadeType(nade.nadeType, candidate.nadeType)) {
            continue;
        }

        if (
            candidate.throwerSteamId !== 0n &&
            nade.throwerSteamId !== 0n &&
            candidate.throwerSteamId !== nade.throwerSteamId
        ) {
            continue;
        }

        const tickDelta = Math.abs(getDetonationTick(candidate) - getDetonationTick(nade));
        if (tickDelta > getMatchTickWindow(nade.nadeType)) continue;

        const trajectoryEnd = getTrajectoryEndPoint(nade);
        const eventToRecordedEnd = distanceSquared(
            { x: candidate.endX, y: candidate.endY },
            { x: nade.endX, y: nade.endY }
        );
        const eventToTrajectoryEnd = trajectoryEnd
            ? distanceSquared({ x: candidate.endX, y: candidate.endY }, trajectoryEnd)
            : eventToRecordedEnd;
        const endDistanceSquared = Math.min(eventToRecordedEnd, eventToTrajectoryEnd);
        if (endDistanceSquared > MATCH_DISTANCE_UNITS * MATCH_DISTANCE_UNITS) continue;

        const score = tickDelta + Math.sqrt(endDistanceSquared) / 4;
        if (score < bestScore) {
            bestScore = score;
            bestMatch = candidate;
        }
    }

    matchingEffectCache.set(nade, bestMatch);
    return bestMatch;
}

function getTrajectoryEndPoint(nade: NadeEvent): Pick<NadePathPoint, 'x' | 'y'> | null {
    const trajectory = nade.trajectory ?? [];
    for (let i = trajectory.length - 1; i >= 0; i--) {
        const point = trajectory[i];
        if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
            return { x: point.x, y: point.y };
        }
    }
    return null;
}

function isMatchingNadeType(a: string, b: string): boolean {
    if (a === b) return true;
    const aIsFire = a === 'molotov' || a === 'incendiary';
    const bIsFire = b === 'molotov' || b === 'incendiary';
    return aIsFire && bIsFire;
}

function getMatchTickWindow(nadeType: string): number {
    return nadeType === 'smoke' ? SMOKE_MATCH_TICK_WINDOW : MATCH_TICK_WINDOW;
}

function getNadeTimelineStartTick(nade: NadeEvent): number {
    const path = getTimedTrajectory(nade);
    return path[0]?.tick ?? getDetonationTick(nade);
}

function getNadeTimelineEndTick(nade: NadeEvent): number {
    return Math.max(getCanonicalFadeTick(nade) || 0, getCanonicalDetonationTick(nade), getNadeTimelineStartTick(nade));
}

function isNadeInRoundRange(nade: NadeEvent, roundRange: { startTick: number; endTick: number } | null): boolean {
    if (!roundRange) return true;
    return getNadeTimelineStartTick(nade) <= roundRange.endTick && getNadeTimelineEndTick(nade) >= roundRange.startTick;
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

    // Draw a short rolling flight trail. Older dashed segments expire after ~0.6s.
    for (const nade of replayData.nades) {
        if (!isNadeInRoundRange(nade, roundRange)) continue;
        drawNadeFlight(ctx, nade, mapMetadata, canvasSize, tick);
    }

    // Draw nade effect zones for active nades (only within current round)
    for (const nade of activeNades) {
        if (!isNadeInRoundRange(nade, roundRange)) continue;
        drawNadeEffect(ctx, nade, mapMetadata, canvasSize);
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
    void replayData, mapMetadata;
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
