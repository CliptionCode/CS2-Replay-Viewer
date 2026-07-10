<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { worldToCanvas } from '$lib/canvas/transforms';
import { equipmentIconPath } from '$lib/equipment-icons';
import { getPlaybackTick, subscribePlaybackTick } from '$lib/playback-state';
import type { ReplayData, NadeEvent, NadeTrajectoryPoint, MapData as MapMetadata } from '$lib/types/replay/replay_pb';

export let replayData: ReplayData | null = null;
export let mapMetadata: MapMetadata;
export let isPlaying: boolean = false;

let container: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let unsubscribeTick: (() => void) | null = null;

const TRAJECTORY_VISIBLE_TICKS = Math.round(64 * 0.6);
const FALLBACK_FLIGHT_DURATION_TICKS = 96; // Used only when a nade has start/end but no sampled trajectory.
const MIN_FLIGHT_DURATION_TICKS = 24;
const MAX_TRUSTED_RAW_FLIGHT_TICKS = 256;
const MAX_TRUSTED_SMOKE_RAW_FLIGHT_TICKS = 640;
const MATCH_DISTANCE_UNITS = 240;
const MATCH_TICK_WINDOW = 768;
const SMOKE_MATCH_TICK_TOLERANCE = 384;
const DECOY_MATCH_TICK_WINDOW = 1536;
const DECOY_COLOR = '#92400e';
const DECOY_EFFECT_TICKS = 960;
const DECOY_EXPIRE_INFERENCE_TICKS = 480;
const STATIONARY_ENDPOINT_DISTANCE_SQUARED = 16;
const TICKS_PER_SECOND = 64;
const SMOKE_EFFECT_TICKS = 18 * TICKS_PER_SECOND;
const FIRE_EFFECT_TICKS = 7 * TICKS_PER_SECOND;
const SMOKE_COUNTDOWN_COLOR = '#86efac';
const FIRE_COUNTDOWN_COLOR = '#9ca3af';
const BASE_EFFECT_ICON_SIZE = 28;
const SMOKE_EFFECT_ICON_SIZE = BASE_EFFECT_ICON_SIZE * 2;
const FIRE_EFFECT_ICON_SIZE = BASE_EFFECT_ICON_SIZE * 1.5;
const FIRE_EFFECT_ICON_OPACITY = 0.5;
const SMOKE_EFFECT_ICON_PATH = equipmentIconPath('map_smoke.svg');
const FIRE_EFFECT_ICON_PATH = equipmentIconPath('inferno.svg');

type NadePathPoint = Pick<NadeTrajectoryPoint, 'tick' | 'x' | 'y' | 'z'>;

let matchingEffectCache = new WeakMap<NadeEvent, NadeEvent | null>();
const effectIconCache = new Map<string, HTMLImageElement>();

function getEffectIconPath(nadeType: string): string | null {
    if (nadeType === 'smoke') return SMOKE_EFFECT_ICON_PATH;
    if (nadeType === 'molotov' || nadeType === 'incendiary') return FIRE_EFFECT_ICON_PATH;
    return null;
}

function getEffectIcon(path: string): HTMLImageElement | null {
    const cached = effectIconCache.get(path);
    if (cached) return cached;
    if (!browser) return null;

    const image = new Image();
    image.decoding = 'async';
    image.onload = scheduleRender;
    image.onerror = scheduleRender;
    image.src = path;
    effectIconCache.set(path, image);
    return image;
}

function drawEffectIcon(context: CanvasRenderingContext2D, nadeType: string, x: number, y: number): void {
    const path = getEffectIconPath(nadeType);
    if (!path) return;

    const image = getEffectIcon(path);
    if (!image?.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;

    const iconSize = nadeType === 'smoke' ? SMOKE_EFFECT_ICON_SIZE : FIRE_EFFECT_ICON_SIZE;
    const scale = Math.min(iconSize / image.naturalWidth, iconSize / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.save();
    if (nadeType === 'molotov' || nadeType === 'incendiary') {
        context.globalAlpha *= FIRE_EFFECT_ICON_OPACITY;
    }
    context.drawImage(image, x - width / 2, y - height / 2, width, height);
    context.restore();
}

function getNadeColor(nadeType: string): string {
    if (nadeType === 'smoke') return '#9ca3af';
    if (nadeType === 'hegrenade') return '#f97316';
    if (nadeType === 'flashbang') return '#fde047';
    if (nadeType === 'molotov' || nadeType === 'incendiary') return '#dc2626';
    if (nadeType === 'decoy') return DECOY_COLOR;
    return '#60a5fa';
}

function getNadeEffectFill(nadeType: string): string {
    if (nadeType === 'smoke') return 'rgba(156, 163, 175, 0.45)';
    if (nadeType === 'hegrenade') return 'rgba(249, 115, 22, 0.3)';
    if (nadeType === 'flashbang') return 'rgba(253, 224, 71, 0.2)';
    if (nadeType === 'molotov' || nadeType === 'incendiary') return 'rgba(220, 38, 38, 0.3)';
    return 'rgba(96, 165, 250, 0.2)';
}

function getNadeEffectRadius(nadeType: string): number {
    if (nadeType === 'smoke') return 45;
    if (nadeType === 'hegrenade') return 62;
    if (nadeType === 'flashbang') return 200;
    if (nadeType === 'molotov' || nadeType === 'incendiary') return 38;
    return 50;
}

function getNadeCountdownColor(nadeType: string): string | null {
    if (nadeType === 'smoke') return SMOKE_COUNTDOWN_COLOR;
    if (nadeType === 'molotov' || nadeType === 'incendiary') return FIRE_COUNTDOWN_COLOR;
    return null;
}

function getRemainingEffectSeconds(nade: NadeEvent, tick: number): number {
    return Math.max(0, Math.ceil((getCanonicalFadeTick(nade) - tick) / TICKS_PER_SECOND));
}

function getDetonationTick(nade: NadeEvent): number {
    return nade.detonationTick || nade.tick;
}

function isDecoyNade(nade: NadeEvent): boolean {
    return nade.nadeType === 'decoy';
}

function isFireNade(nade: NadeEvent): boolean {
    return nade.nadeType === 'molotov' || nade.nadeType === 'incendiary';
}

function hasTrajectory(nade: NadeEvent): boolean {
    return (nade.trajectory?.length ?? 0) >= 2;
}

function isProjectileNadeRecord(nade: NadeEvent): boolean {
    return hasTrajectory(nade) || hasUsableStartPosition(nade);
}

function isLegacyDestroyedFireProjectile(nade: NadeEvent, effect: NadeEvent | null): boolean {
    const recordedTick = getDetonationTick(nade);
    return isFireNade(nade) && effect === null && isProjectileNadeRecord(nade) && nade.fadeTick > recordedTick;
}

function getLegacyFireStartTick(nade: NadeEvent): number {
    const recordedExpiryTick = getDetonationTick(nade);
    const earliestAllowedStartTick = Math.max(0, recordedExpiryTick - FIRE_EFFECT_TICKS);
    const stationaryStartTick = inferStationaryEndpointStartTick(nade);
    if (stationaryStartTick > 0 && stationaryStartTick <= recordedExpiryTick) {
        return Math.max(earliestAllowedStartTick, stationaryStartTick);
    }
    return earliestAllowedStartTick;
}

function getCanonicalDetonationTick(nade: NadeEvent): number {
    const effect = getMatchingEffectEvent(nade);
    if (effect) return getDetonationTick(effect);
    if (isLegacyDestroyedFireProjectile(nade, effect)) return getLegacyFireStartTick(nade);
    if (isDecoyNade(nade)) return getDecoyLandingTick(nade);
    return getDetonationTick(nade);
}

function getCanonicalFadeTick(nade: NadeEvent): number {
    const effect = getMatchingEffectEvent(nade);
    if (nade.nadeType === 'smoke') {
        return getDetonationTick(effect ?? nade) + SMOKE_EFFECT_TICKS;
    }
    if (isFireNade(nade)) {
        const recordedTick = getDetonationTick(nade);
        const detonationTick = effect
            ? getDetonationTick(effect)
            : isLegacyDestroyedFireProjectile(nade, effect)
                ? getLegacyFireStartTick(nade)
                : recordedTick;
        const observedFadeTick = effect
            ? effect.fadeTick
            : isLegacyDestroyedFireProjectile(nade, effect)
                ? recordedTick
                : nade.fadeTick;
        const fadeTick = observedFadeTick || detonationTick + FIRE_EFFECT_TICKS;
        return Math.min(
            detonationTick + FIRE_EFFECT_TICKS,
            Math.max(detonationTick, fadeTick)
        );
    }
    if (effect) return effect.fadeTick || nade.fadeTick;
    if (isDecoyNade(nade)) return getDecoyExpiryTick(nade);
    return nade.fadeTick;
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

function inferStationaryEndpointStartTick(nade: NadeEvent): number {
    const trajectory = nade.trajectory ?? [];
    if (trajectory.length < 2) return 0;

    const finalPoint = trajectory[trajectory.length - 1];
    let stationaryStartTick = finalPoint.tick;

    for (let i = trajectory.length - 2; i >= 0; i--) {
        const point = trajectory[i];
        if (distanceSquared(point, finalPoint) > STATIONARY_ENDPOINT_DISTANCE_SQUARED) {
            return stationaryStartTick > 0 ? stationaryStartTick : 0;
        }
        if (point.tick > 0) {
            stationaryStartTick = point.tick;
        }
    }

    return 0;
}

function getDecoyLandingTick(nade: NadeEvent): number {
    const detonationTick = getDetonationTick(nade);
    const trajectoryLandingTick = inferStationaryEndpointStartTick(nade);

    if (
        trajectoryLandingTick > 0 &&
        detonationTick - trajectoryLandingTick > DECOY_EXPIRE_INFERENCE_TICKS
    ) {
        return trajectoryLandingTick;
    }

    return detonationTick;
}

function getDecoyExpiryTick(nade: NadeEvent): number {
    const detonationTick = getDetonationTick(nade);
    const landingTick = getDecoyLandingTick(nade);
    const fadeTick = nade.fadeTick;

    if (
        detonationTick - landingTick > DECOY_EXPIRE_INFERENCE_TICKS &&
        fadeTick - detonationTick >= DECOY_EFFECT_TICKS - TRAJECTORY_VISIBLE_TICKS
    ) {
        return detonationTick;
    }

    return fadeTick || Math.max(detonationTick, landingTick + DECOY_EFFECT_TICKS);
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
    canvasSize: { width: number; height: number },
    tick: number
): void {
    const endPoint = getCanonicalEndPoint(nade);
    const pos = worldToCanvas(endPoint.x, endPoint.y, mapMetadata, canvasSize);

    ctx.save();
    if (isDecoyNade(nade)) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillStyle = DECOY_COLOR;
        ctx.font = '800 12px Inter, sans-serif';
        ctx.strokeText('Decoy', pos.x, pos.y - 10);
        ctx.fillText('Decoy', pos.x, pos.y - 10);

        ctx.fillStyle = getNadeColor(nade.nadeType);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        return;
    }

    ctx.fillStyle = getNadeEffectFill(nade.nadeType);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, getNadeEffectRadius(nade.nadeType), 0, Math.PI * 2);
    ctx.fill();

    drawEffectIcon(ctx, nade.nadeType, pos.x, pos.y);

    const countdownColor = getNadeCountdownColor(nade.nadeType);
    if (countdownColor) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillStyle = countdownColor;
        ctx.font = '800 13px Inter, sans-serif';
        const countdownText = `${getRemainingEffectSeconds(nade, tick)}s`;
        ctx.strokeText(countdownText, pos.x, pos.y);
        ctx.fillText(countdownText, pos.x, pos.y);
    }
    ctx.restore();
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

function resizeCanvas(container: HTMLCanvasElement): { width: number; height: number } {
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
        return detTick > 0 && fadeTick > 0 && detTick <= tick && tick < fadeTick && !isTrajectoryEffectDuplicate(n);
    });
}

function isTrajectoryEffectDuplicate(nade: NadeEvent): boolean {
    return isProjectileNadeRecord(nade) && getMatchingEffectEvent(nade) !== null;
}

function getMatchingEffectEvent(nade: NadeEvent): NadeEvent | null {
    if (!isProjectileNadeRecord(nade) || !replayData?.nades) return null;
    const cached = matchingEffectCache.get(nade);
    if (cached !== undefined) return cached;

    let bestMatch: NadeEvent | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of replayData.nades) {
        if (candidate === nade || isProjectileNadeRecord(candidate) || !isMatchingNadeType(nade.nadeType, candidate.nadeType)) {
            continue;
        }

        if (
            candidate.throwerSteamId !== 0n &&
            nade.throwerSteamId !== 0n &&
            candidate.throwerSteamId !== nade.throwerSteamId
        ) {
            continue;
        }

        const recordedTickDelta = getDetonationTick(nade) - getDetonationTick(candidate);
        const tickDelta = nade.nadeType === 'smoke'
            ? Math.abs(recordedTickDelta - SMOKE_EFFECT_TICKS)
            : Math.abs(recordedTickDelta);
        if (nade.nadeType === 'smoke' && recordedTickDelta < 0) continue;
        if (isFireNade(nade) && (recordedTickDelta < 0 || recordedTickDelta > FIRE_EFFECT_TICKS)) continue;
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

        const score = isFireNade(nade)
            ? Math.sqrt(endDistanceSquared) * 4 + tickDelta / TICKS_PER_SECOND
            : tickDelta + Math.sqrt(endDistanceSquared) / 4;
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
    if (nadeType === 'smoke') return SMOKE_MATCH_TICK_TOLERANCE;
    if (nadeType === 'decoy') return DECOY_MATCH_TICK_WINDOW;
    return MATCH_TICK_WINDOW;
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
    ctx.save();

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
        drawNadeEffect(ctx, nade, mapMetadata, canvasSize, tick);
    }
    ctx.restore();
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
    transform: var(--replay-viewport-transform, none);
    transform-origin: 0 0;
    will-change: transform;
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
