<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { worldToCanvas } from '$lib/canvas/transforms';
import { equipmentIconPath, getWeaponIconPath } from '$lib/equipment-icons';
import { getPlaybackTick, subscribePlaybackTick } from '$lib/playback-state';
import { getRoundDisplayEndTick, getRoundForTick } from '$lib/replay/rounds';
import type { FlashEvent, NoiseEvent, ReplayData, PlayerFrame, MapData as MapMetadata } from '$lib/types/replay/replay_pb';

export let replayData: ReplayData | null = null;
export let mapMetadata: MapMetadata;
export let isPlaying: boolean = false;
export let sightConeLength: number = 75;
export let sightConeHalfAngle: number = 0.68;
export let sightConeTransparencyPercent = 84;
export let showSightCone = true;
export let sightConeForSelectedPlayer = false;
export let showLineOfSight = false;
export let lineOfSightLength = 300;
export let lineOfSightWidth = 1.6;
export let selectedPlayerSteamId: bigint | null = null;
export let showPlayerUtilities = true;
export let showPlayerC4 = true;
export let showPlayerDefuseKit = true;
export let showNoiseCircle = false;
export let noiseForSelectedPlayer = false;
export let showCtNoiseCircle = true;
export let showTNoiseCircle = true;
export let enabledNoiseSources: Record<string, boolean> = {
    running: true,
    jump: true,
    shooting: true,
    falling: true,
    weapon_drop: true,
    utility_drop: true,
    c4_drop: true,
    weapon_reload: true,
};

let container: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let equipmentCanvas: HTMLCanvasElement | null = null;
let equipmentCtx: CanvasRenderingContext2D | null = null;
let noiseCanvas: HTMLCanvasElement | null = null;
let noiseCtx: CanvasRenderingContext2D | null = null;
let sightCanvas: HTMLCanvasElement | null = null;
let sightCtx: CanvasRenderingContext2D | null = null;

let playerFrames = new Map<string, PlayerFrame>();
let trails: Map<string, PlayerFrame[]> = new Map();
let playerFrameIndices = new Map<string, number>();
let trailLength = 128;

let trailCache = new Map<string, PlayerFrame[]>();
let trailCursor = new Map<string, number>();
let cachedRoundKey: string | null = null;
let unsubscribeTick: (() => void) | null = null;
let flashEventsBySteamId = new Map<string, FlashEvent[]>();
let noiseEvents: NoiseEvent[] = [];
let maxNoiseLookbackTicks = 1;

const MAX_INTERPOLATION_GAP_TICKS = 16;
const TEAM_T = 2;
const TEAM_CT = 3;
const HIGHLIGHT_COLOR = '#22c55e';
const RUNNING_NOISE_HOLD_TICKS = 28;
const RUNNING_NOISE_FADE_TICKS = 14;
const MAX_FULL_FLASH_DURATION_SECONDS = 5;
const MAX_FLASH_ALPHA = 255;
const DEATH_ICON_PATH = equipmentIconPath('icon-death.svg');
const DEATH_ICON_SIZE = 18;
const UTILITY_ICON_SIZE = 13;
const UTILITY_ICON_GAP = 3;
let deathIcon: HTMLImageElement | null = null;
const tintedDeathIcons = new Map<string, HTMLCanvasElement>();
const equipmentIcons = new Map<string, HTMLImageElement>();

function getEquipmentIcon(equipmentName: string): HTMLImageElement | null {
    const path = getWeaponIconPath(equipmentName);
    const cached = equipmentIcons.get(path);
    if (cached) return cached;
    if (!browser) return null;

    const image = new Image();
    image.decoding = 'async';
    image.onload = scheduleEquipmentRender;
    image.onerror = scheduleEquipmentRender;
    image.src = path;
    equipmentIcons.set(path, image);
    return image;
}

function drawUtilityInventory(
    context: CanvasRenderingContext2D,
    utilities: readonly string[],
    centerX: number,
    centerY: number
): void {
    if (utilities.length === 0) return;

    const totalWidth = utilities.length * UTILITY_ICON_SIZE + UTILITY_ICON_GAP * (utilities.length - 1);
    let x = centerX - totalWidth / 2;
    for (const utility of utilities) {
        const image = getEquipmentIcon(utility);
        if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
            const scale = Math.min(UTILITY_ICON_SIZE / image.naturalWidth, UTILITY_ICON_SIZE / image.naturalHeight);
            const width = image.naturalWidth * scale;
            const height = image.naturalHeight * scale;
            context.drawImage(
                image,
                x + (UTILITY_ICON_SIZE - width) / 2,
                centerY - height / 2,
                width,
                height
            );
        }
        x += UTILITY_ICON_SIZE + UTILITY_ICON_GAP;
    }
}

function getDeathIcon(): HTMLImageElement | null {
    if (deathIcon || !browser) return deathIcon;
    deathIcon = new Image();
    deathIcon.decoding = 'async';
    deathIcon.onload = () => {
        tintedDeathIcons.clear();
        scheduleRender();
    };
    deathIcon.onerror = scheduleRender;
    deathIcon.src = DEATH_ICON_PATH;
    return deathIcon;
}

function getTintedDeathIcon(color: string): HTMLCanvasElement | null {
    const cached = tintedDeathIcons.get(color);
    if (cached) return cached;
    const image = getDeathIcon();
    if (!image?.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0 || !browser) return null;

    const tinted = document.createElement('canvas');
    tinted.width = image.naturalWidth;
    tinted.height = image.naturalHeight;
    const tintedContext = tinted.getContext('2d');
    if (!tintedContext) return null;
    tintedContext.drawImage(image, 0, 0);
    tintedContext.globalCompositeOperation = 'source-in';
    tintedContext.fillStyle = color;
    tintedContext.fillRect(0, 0, tinted.width, tinted.height);
    tintedDeathIcons.set(color, tinted);
    return tinted;
}

function drawDeathIcon(context: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const tintedIcon = getTintedDeathIcon(color);
    if (tintedIcon) {
        const scale = Math.min(DEATH_ICON_SIZE / tintedIcon.width, DEATH_ICON_SIZE / tintedIcon.height);
        const width = tintedIcon.width * scale;
        const height = tintedIcon.height * scale;
        context.drawImage(tintedIcon, x - width / 2, y - height / 2, width, height);
        return;
    }

    context.save();
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x - 5, y - 5);
    context.lineTo(x + 5, y + 5);
    context.moveTo(x + 5, y - 5);
    context.lineTo(x - 5, y + 5);
    context.stroke();
    context.restore();
}

function lerp(start: number, end: number, alpha: number): number {
    return start + (end - start) * alpha;
}

function lerpAngle(start: number, end: number, alpha: number): number {
    const delta = ((end - start + 540) % 360) - 180;
    return start + delta * alpha;
}

function interpolateFrame(current: PlayerFrame, next: PlayerFrame | undefined, tick: number): PlayerFrame {
    if (!next || next.tick <= current.tick) return current;

    const tickGap = next.tick - current.tick;
    if (tickGap > MAX_INTERPOLATION_GAP_TICKS) return current;

    const alpha = Math.max(0, Math.min(1, (tick - current.tick) / tickGap));
    if (alpha <= 0) return current;

    return {
        ...current,
        x: lerp(current.x, next.x, alpha),
        y: lerp(current.y, next.y, alpha),
        z: lerp(current.z, next.z, alpha),
        yaw: lerpAngle(current.yaw, next.yaw, alpha),
        pitch: lerp(current.pitch, next.pitch, alpha),
    };
}

function initializeTrails(): void {
    trails.clear();
    playerFrameIndices.clear();
    trailCache.clear();
    trailCursor.clear();
    flashEventsBySteamId.clear();
    noiseEvents = [];
    maxNoiseLookbackTicks = 1;
    cachedRoundKey = null;
    cachedKills = null;
    cachedKillsKey = null;
    if (!replayData?.frames) return;

    const playableSteamIds = getPlayableSteamIds();
    if (playableSteamIds.size === 0) return;
    
    for (const frame of replayData.frames) {
        const steamId = frame.steamId.toString();
        if (!playableSteamIds.has(steamId)) continue;
        if (!trails.has(steamId)) {
            trails.set(steamId, []);
        }
        trails.get(steamId)?.push(frame);
    }

    for (const flash of replayData.flashes ?? []) {
        const steamId = flash.playerSteamId.toString();
        if (!flashEventsBySteamId.has(steamId)) {
            flashEventsBySteamId.set(steamId, []);
        }
        flashEventsBySteamId.get(steamId)?.push(flash);
    }
    for (const events of flashEventsBySteamId.values()) {
        events.sort((a, b) => a.tick - b.tick);
    }

    noiseEvents = [...(replayData.noises ?? [])].sort((a, b) => a.tick - b.tick);
    maxNoiseLookbackTicks = noiseEvents.reduce((maxTicks, noise) => {
        const runningTail = normalizeNoiseType(noise.noiseType) === 'running'
            ? RUNNING_NOISE_HOLD_TICKS + RUNNING_NOISE_FADE_TICKS
            : 0;
        return Math.max(maxTicks, Math.max(1, noise.endTick - noise.tick) + runningTail);
    }, 1);
}

function getPlayableSteamIds(): Set<string> {
    const ids = new Set<string>();
    for (const player of replayData?.players ?? []) {
        if (player.team === TEAM_T || player.team === TEAM_CT) {
            ids.add(player.steamId.toString());
        }
    }
    return ids;
}

function updatePlayerFrames(tick: number): void {
    playerFrames.clear();
    if (!replayData?.frames) return;
    
    for (const [steamId, trail] of trails) {
        let idx = playerFrameIndices.get(steamId) ?? 0;
        
        if (idx >= trail.length || trail[idx].tick > tick) {
            let lo = 0, hi = trail.length - 1, best = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >>> 1;
                if (trail[mid].tick <= tick) {
                    best = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
            idx = best;
        } else {
            while (idx < trail.length - 1 && trail[idx + 1].tick <= tick) {
                idx++;
            }
        }
        
        playerFrameIndices.set(steamId, idx);
        playerFrames.set(steamId, interpolateFrame(trail[idx], trail[idx + 1], tick));
    }
}

// Look up the team for a player by steamId
function getCurrentRoundData(tick: number): any {
    return getRoundForTick(replayData, tick);
}

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

function getPlayerTeam(steamId: string, tick: number): number {
    if (!replayData?.players) return 0;
    const id = BigInt(steamId);
    const player = replayData.players.find(p => p.steamId === id);
    if (!player) return 0;
    
    // The stored team is from the end of the match (second half).
    // In CS2 MR12, teams switch after round 12.
    // For rounds before the side switch, flip T<->CT.
    const round = getCurrentRoundData(tick);
    if (round) {
        // Regulation: half size = 12. Overtime: half size = 3.
        const halfSize = round.roundNumber <= 24 ? 12 : 3;
        const halfIndex = Math.floor((round.roundNumber - 1) / halfSize);
        const isOddHalf = halfIndex % 2 === 0;
        if (isOddHalf) {
            if (player.team === 2) return 3;
            if (player.team === 3) return 2;
        }
    }
    
    return player.team;
}

function getPlayerName(steamId: string): string {
    if (!replayData?.players) return `Player ${steamId}`;
    const id = BigInt(steamId);
    const player = replayData.players.find(p => p.steamId === id);
    return player?.name || `Player ${steamId}`;
}

function isSelectedPlayer(steamId: string): boolean {
    return selectedPlayerSteamId !== null && selectedPlayerSteamId.toString() === steamId;
}

function shouldDrawSightCone(steamId: string): boolean {
    return showSightCone && (!sightConeForSelectedPlayer || isSelectedPlayer(steamId));
}

function normalizeNoiseType(noiseType: string): string {
    if (!noiseType || noiseType === 'sound' || noiseType === 'footstep') return 'running';
    if (
        noiseType === 'jump' || noiseType === 'running' || noiseType === 'shooting' ||
        noiseType === 'falling' || noiseType === 'weapon_drop' || noiseType === 'utility_drop' ||
        noiseType === 'c4_drop' || noiseType === 'weapon_reload'
    ) {
        return noiseType;
    }
    return '';
}

function isNoiseEnabled(noise: NoiseEvent): boolean {
    if (!showNoiseCircle) return false;

    const steamId = noise.steamId.toString();
    if (noiseForSelectedPlayer && !isSelectedPlayer(steamId)) return false;
    const eventFrame = getPlayerFrameAtOrBefore(noise.steamId, noise.tick);
    const team = eventFrame?.team || getPlayerTeam(steamId, noise.tick);
    if (team === TEAM_CT && !showCtNoiseCircle) return false;
    if (team === TEAM_T && !showTNoiseCircle) return false;

    const normalizedType = normalizeNoiseType(noise.noiseType);
    if (!normalizedType) return false;
    return enabledNoiseSources[normalizedType] ?? false;
}

function updateTrailCache(tick: number): void {
    const roundRange = getCurrentRoundRange(tick);
    const roundKey = roundRange ? `${roundRange.startTick}-${roundRange.endTick}` : 'full';

    if (roundKey !== cachedRoundKey) {
        trailCache.clear();
        trailCursor.clear();
        cachedRoundKey = roundKey;

        for (const [steamId, fullTrail] of trails) {
            let filtered: PlayerFrame[];
            if (roundRange) {
                filtered = fullTrail.filter(f =>
                    f.tick >= roundRange.startTick && f.tick <= roundRange.endTick
                );
            } else {
                filtered = [...fullTrail];
            }
            trailCache.set(steamId, filtered);
            trailCursor.set(steamId, -1);
        }
    }

    for (const [steamId, trail] of trailCache) {
        let cur = trailCursor.get(steamId) ?? -1;
        if (cur >= 0 && cur < trail.length && trail[cur].tick <= tick) {
            while (cur + 1 < trail.length && trail[cur + 1].tick <= tick) {
                cur++;
            }
        } else {
            let lo = 0, hi = trail.length - 1, best = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >>> 1;
                if (trail[mid].tick <= tick) {
                    best = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
            cur = best;
        }
        trailCursor.set(steamId, cur);
    }
}

function getCachedTrail(steamId: string): PlayerFrame[] {
    const trail = trailCache.get(steamId);
    if (!trail) return [];
    const endIdx = trailCursor.get(steamId) ?? -1;
    if (endIdx < 0) return [];
    const startIdx = Math.max(0, endIdx - trailLength + 1);
    return trail.slice(startIdx, endIdx + 1);
}

function getPlayerFrameAtOrBefore(steamId: bigint, tick: number): PlayerFrame | null {
    const trail = trails.get(steamId.toString());
    if (!trail || trail.length === 0) return null;

    let lo = 0;
    let hi = trail.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (trail[mid].tick <= tick) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return best >= 0 ? trail[best] : null;
}

function hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    const value = Number.parseInt(normalized.length === 3
        ? normalized.split('').map(char => char + char).join('')
        : normalized, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getLookCanvasAngle(
    frame: PlayerFrame,
    pos: { x: number; y: number },
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number }
): number | null {
    if (!Number.isFinite(frame.yaw)) return null;

    const yawRad = frame.yaw * Math.PI / 180;
    const lookTarget = worldToCanvas(
        frame.x + Math.cos(yawRad) * 128,
        frame.y + Math.sin(yawRad) * 128,
        mapMetadata,
        canvasSize
    );
    return Math.atan2(lookTarget.y - pos.y, lookTarget.x - pos.x);
}

function drawPlayerSightCone(
    ctx: CanvasRenderingContext2D,
    frame: PlayerFrame,
    pos: { x: number; y: number },
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    color: string
): void {
    const angle = getLookCanvasAngle(frame, pos, mapMetadata, canvasSize);
    if (angle === null) return;

    const coneLength = Math.max(8, sightConeLength);
    const coneHalfAngle = Math.max(0.05, sightConeHalfAngle);
    const leftAngle = angle - coneHalfAngle;
    const rightAngle = angle + coneHalfAngle;
    const leftX = pos.x + Math.cos(leftAngle) * coneLength;
    const leftY = pos.y + Math.sin(leftAngle) * coneLength;
    const rightX = pos.x + Math.cos(rightAngle) * coneLength;
    const rightY = pos.y + Math.sin(rightAngle) * coneLength;
    const tipX = pos.x + Math.cos(angle) * (coneLength + 4);
    const tipY = pos.y + Math.sin(angle) * (coneLength + 4);

    ctx.save();
    const fillOpacity = 1 - Math.max(0, Math.min(100, sightConeTransparencyPercent)) / 100;
    ctx.fillStyle = hexToRgba(color, fillOpacity);
    ctx.strokeStyle = hexToRgba(color, 0.88);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(leftX, leftY);
    ctx.quadraticCurveTo(tipX, tipY, rightX, rightY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function drawPlayerLineOfSight(
    ctx: CanvasRenderingContext2D,
    frame: PlayerFrame,
    pos: { x: number; y: number },
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    color: string
): void {
    const angle = getLookCanvasAngle(frame, pos, mapMetadata, canvasSize);
    if (angle === null) return;

    const length = Math.max(18, lineOfSightLength);
    const endX = pos.x + Math.cos(angle) * length;
    const endY = pos.y + Math.sin(angle) * length;

    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.9);
    ctx.lineWidth = Math.max(0.1, Math.min(5, lineOfSightWidth));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();
}

function getActiveFlash(steamId: string, tick: number): FlashEvent | null {
    const flashes = flashEventsBySteamId.get(steamId);
    if (!flashes) return null;

    for (let i = flashes.length - 1; i >= 0; i--) {
        const flash = flashes[i];
        if (flash.tick > tick) continue;
        if (tick <= flash.endTick) return flash;
        return null;
    }

    return null;
}

function drawFlashCircle(
    ctx: CanvasRenderingContext2D,
    flash: FlashEvent | null,
    tick: number,
    pos: { x: number; y: number }
): void {
    if (!flash || flash.endTick <= flash.tick) return;

    const totalTicks = Math.max(1, flash.endTick - flash.tick);
    const remainingRatio = Math.max(0, Math.min(1, (flash.endTick - tick) / totalTicks));
    const durationIntensity = flash.durationSeconds / MAX_FULL_FLASH_DURATION_SECONDS;
    const recordedIntensity = flash.maxAlpha > 0 ? flash.maxAlpha / MAX_FLASH_ALPHA : durationIntensity;
    const flashIntensity = Math.max(0, Math.min(1, recordedIntensity));
    const alpha = flashIntensity * remainingRatio;
    if (alpha <= 0) return;

    ctx.save();
    ctx.fillStyle = `rgba(156, 163, 175, ${alpha})`;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function getWorldRadiusInCanvasPixels(
    x: number,
    y: number,
    radius: number,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number }
): number {
    const center = worldToCanvas(x, y, mapMetadata, canvasSize);
    const edge = worldToCanvas(x + radius, y, mapMetadata, canvasSize);
    return Math.max(1, Math.hypot(edge.x - center.x, edge.y - center.y));
}

function drawNoiseCircles(
    ctx: CanvasRenderingContext2D,
    tick: number,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number }
): void {
    if (!showNoiseCircle) return;

    const activeRunningNoises = new Map<string, NoiseEvent>();
    const firstRelevantTick = tick - maxNoiseLookbackTicks;
    let low = 0;
    let high = noiseEvents.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (noiseEvents[middle].tick < firstRelevantTick) low = middle + 1;
        else high = middle;
    }

    for (let index = low; index < noiseEvents.length; index++) {
        const noise = noiseEvents[index];
        if (noise.tick > tick) break;
        if (noise.radius <= 0 || !isNoiseEnabled(noise)) continue;

        const normalizedType = normalizeNoiseType(noise.noiseType);
        if (normalizedType === 'running') {
            if (tick <= noise.endTick + RUNNING_NOISE_HOLD_TICKS + RUNNING_NOISE_FADE_TICKS) {
                activeRunningNoises.set(noise.steamId.toString(), noise);
            }
            continue;
        }

        if (noise.endTick < tick) continue;

        const followsPlayer = normalizedType === 'shooting' || normalizedType === 'weapon_reload';
        const playerFrame = playerFrames.get(noise.steamId.toString());
        if (followsPlayer && !playerFrame?.isAlive) continue;

        const totalTicks = Math.max(1, noise.endTick - noise.tick);
        const remainingRatio = Math.max(0.22, Math.min(1, (noise.endTick - tick) / totalTicks));
        const circleX = followsPlayer ? playerFrame!.x : noise.x;
        const circleY = followsPlayer ? playerFrame!.y : noise.y;
        const pos = worldToCanvas(circleX, circleY, mapMetadata, canvasSize);
        const radius = getWorldRadiusInCanvasPixels(circleX, circleY, noise.radius, mapMetadata, canvasSize);

        ctx.save();
        ctx.strokeStyle = `rgba(239, 68, 68, ${0.75 * remainingRatio})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    for (const [steamId, noise] of activeRunningNoises) {
        const playerFrame = playerFrames.get(steamId);
        if (!playerFrame?.isAlive) continue;

        const fadeTicks = Math.max(0, tick - noise.endTick - RUNNING_NOISE_HOLD_TICKS);
        if (fadeTicks > RUNNING_NOISE_FADE_TICKS) continue;

        const fadeRatio = 1 - fadeTicks / RUNNING_NOISE_FADE_TICKS;
        const pos = worldToCanvas(playerFrame.x, playerFrame.y, mapMetadata, canvasSize);
        const radius = getWorldRadiusInCanvasPixels(playerFrame.x, playerFrame.y, noise.radius, mapMetadata, canvasSize);

        ctx.save();
        ctx.strokeStyle = `rgba(239, 68, 68, ${0.78 * fadeRatio})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function getBombEventsForRound(round: { startTick: number; endTick: number }): { tick: number; eventType: string; playerSteamId: bigint }[] {
    return [...(replayData?.bombs ?? [])]
        .filter(event => event.tick >= round.startTick && event.tick <= round.endTick)
        .sort((a, b) => a.tick - b.tick);
}

function getActiveBombPlant(tick: number): { x: number; y: number; plantTick: number } | null {
    const round = getCurrentRoundData(tick);
    if (!round) return null;

    const events = getBombEventsForRound(round);
    const planted = events
        .filter(event => event.eventType === 'planted' && event.tick <= tick)
        .pop();
    if (!planted || planted.playerSteamId === 0n) return null;
    const terminal = events.find(event =>
        (event.eventType === 'defused' || event.eventType === 'exploded') &&
        event.tick >= planted.tick &&
        event.tick <= tick
    );
    if (terminal) return null;

    const planterFrame = getPlayerFrameAtOrBefore(planted.playerSteamId, planted.tick);
    if (!planterFrame) return null;

    return { x: planterFrame.x, y: planterFrame.y, plantTick: planted.tick };
}

function drawBombDot(
    ctx: CanvasRenderingContext2D,
    tick: number,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number }
): void {
    const bombPosition = getActiveBombPlant(tick);
    if (!bombPosition) return;

    const pos = worldToCanvas(bombPosition.x, bombPosition.y, mapMetadata, canvasSize);
    const tickRate = replayData?.header?.tickRate || 64;
    const bombTimeSeconds = replayData?.header?.bombTimeSeconds || 40;
    const explosionTick = bombPosition.plantTick + Math.round(bombTimeSeconds * tickRate);
    const secondsLeft = Math.max(0, Math.ceil((explosionTick - tick) / tickRate));
    const bombLabel = `Bomb ${secondsLeft}s`;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillStyle = '#ef4444';
    ctx.font = '800 12px Inter, sans-serif';
    ctx.strokeText(bombLabel, pos.x, pos.y - 10);
    ctx.fillText(bombLabel, pos.x, pos.y - 10);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}

function drawPlayer(
    ctx: CanvasRenderingContext2D,
    frame: PlayerFrame,
    steamId: string,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    tick: number
): void {
    const pos = worldToCanvas(frame.x, frame.y, mapMetadata, canvasSize);
    
    const isAlive = frame.isAlive ?? true;
    const team = getPlayerTeam(steamId, tick);
    if (team !== TEAM_T && team !== TEAM_CT) return;

    const teamColor = team === 2 ? '#f97316' : team === 3 ? '#3b82f6' : '#6b7280';
    const isSelected = isSelectedPlayer(steamId);
    const playerColor = isSelected && isAlive ? HIGHLIGHT_COLOR : teamColor;

    drawFlashCircle(ctx, getActiveFlash(steamId, tick), tick, pos);
    
    if (isAlive) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = playerColor;
        ctx.fill();
        ctx.strokeStyle = isSelected ? HIGHLIGHT_COLOR : '#ffffff';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
    } else {
        drawDeathIcon(ctx, pos.x, pos.y, teamColor);
    }

    if (isSelected) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = HIGHLIGHT_COLOR;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    
    if (isAlive) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';

        const playerName = getPlayerName(steamId);
        const weapon = frame.weapon
            ? `${frame.weapon}${frame.isReloading ? ' (Reloading)' : ''}`
            : '';
        const nameY = weapon ? pos.y - 24 : pos.y - 10;

        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillStyle = playerColor;
        ctx.strokeText(playerName, pos.x, nameY);
        ctx.fillText(playerName, pos.x, nameY);

        if (weapon) {
            ctx.font = '12px Inter, sans-serif';
            ctx.fillStyle = '#e2e8f0';
            ctx.strokeText(weapon, pos.x, pos.y - 10);
            ctx.fillText(weapon, pos.x, pos.y - 10);
        }
    }
    
    if (isAlive) {
        const health = Math.max(0, Math.min(100, frame.health ?? 0));
        const healthColor = health < 50 ? '#ef4444' : '#4ade80';
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(pos.x - 10, pos.y + 8, 20, 3);
        ctx.fillStyle = healthColor;
        ctx.fillRect(pos.x - 10, pos.y + 8, 20 * health / 100, 3);
    }
}

function drawPlayerEquipment(
    context: CanvasRenderingContext2D,
    frame: PlayerFrame,
    steamId: string,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    tick: number
): void {
    if (!(frame.isAlive ?? true)) return;

    const team = getPlayerTeam(steamId, tick);
    if (team !== TEAM_T && team !== TEAM_CT) return;

    const utilities = [
        ...(showPlayerUtilities ? (frame.utilities ?? []) : []),
        ...(showPlayerC4 && frame.hasBomb ? ['C4'] : []),
        ...(showPlayerDefuseKit && team === TEAM_CT && frame.hasDefuseKit ? ['Defuse Kit'] : []),
    ].sort((a, b) => a.localeCompare(b));
    if (utilities.length === 0) return;

    const pos = worldToCanvas(frame.x, frame.y, mapMetadata, canvasSize);
    const nameY = frame.weapon ? pos.y - 24 : pos.y - 10;
    drawUtilityInventory(context, utilities, pos.x, nameY - 15);
}

function drawPlayerSightOverlay(
    context: CanvasRenderingContext2D,
    frame: PlayerFrame,
    steamId: string,
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    tick: number
): void {
    if (!(frame.isAlive ?? true)) return;

    const team = getPlayerTeam(steamId, tick);
    if (team !== TEAM_T && team !== TEAM_CT) return;

    const pos = worldToCanvas(frame.x, frame.y, mapMetadata, canvasSize);
    const teamColor = team === TEAM_T ? '#f97316' : '#3b82f6';
    const playerColor = isSelectedPlayer(steamId) ? HIGHLIGHT_COLOR : teamColor;

    if (shouldDrawSightCone(steamId)) {
        drawPlayerSightCone(context, frame, pos, mapMetadata, canvasSize, playerColor);
    }
    if (showLineOfSight) {
        drawPlayerLineOfSight(context, frame, pos, mapMetadata, canvasSize, playerColor);
    }
}

function drawPlayerTrail(
    ctx: CanvasRenderingContext2D,
    trail: PlayerFrame[],
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number }
): void {
    if (trail.length < 2) return;
    
    ctx.beginPath();
    
    const firstFrame = trail[0];
    const firstPos = worldToCanvas(firstFrame.x, firstFrame.y, mapMetadata, canvasSize);
    ctx.moveTo(firstPos.x, firstPos.y);
    
    for (let i = 1; i < trail.length; i++) {
        const frame = trail[i];
        const pos = worldToCanvas(frame.x, frame.y, mapMetadata, canvasSize);
        ctx.lineTo(pos.x, pos.y);
    }
    
    ctx.strokeStyle = 'rgba(156, 163, 175, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

let cachedKills: any[] | null = null;
let cachedKillsKey: string | null = null;

function getCachedKillsInCurrentRound(tick: number): any[] {
    const roundRange = getCurrentRoundRange(tick);
    const key = roundRange ? `${roundRange.startTick}-${roundRange.endTick}` : 'full';
    if (key !== cachedKillsKey || cachedKills === null) {
        cachedKillsKey = key;
        if (!roundRange || !replayData?.kills) {
            cachedKills = replayData?.kills || [];
        } else {
            cachedKills = replayData.kills.filter(k =>
                k.tick >= roundRange.startTick && k.tick <= roundRange.endTick
            );
        }
    }
    return cachedKills;
}

function drawKillMarkers(
    ctx: CanvasRenderingContext2D,
    kills: any[],
    mapMetadata: MapMetadata,
    canvasSize: { width: number; height: number },
    currentTick: number
): void {
    const recentKills = kills.filter(k => 
        k.tick >= currentTick - 64 && k.tick <= currentTick
    );
    
    for (const kill of recentKills) {
        const pos = worldToCanvas(kill.victimX, kill.victimY, mapMetadata, canvasSize);
        
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(pos.x - 8, pos.y - 8);
        ctx.lineTo(pos.x + 8, pos.y + 8);
        ctx.moveTo(pos.x + 8, pos.y - 8);
        ctx.lineTo(pos.x - 8, pos.y + 8);
        ctx.stroke();
    }
}

let rafId: number | null = null;
let equipmentRafId: number | null = null;
let noiseRafId: number | null = null;
let sightRafId: number | null = null;
let renderLoopId: number | null = null;

function scheduleRender() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
        rafId = null;
        render();
    });
}

function scheduleEquipmentRender() {
    if (equipmentRafId !== null) return;
    equipmentRafId = requestAnimationFrame(() => {
        equipmentRafId = null;
        renderEquipmentOnly();
    });
}

function scheduleSightRender() {
    if (sightRafId !== null) return;
    sightRafId = requestAnimationFrame(() => {
        sightRafId = null;
        renderSightOnly();
    });
}

function scheduleNoiseRender() {
    if (noiseRafId !== null) return;
    noiseRafId = requestAnimationFrame(() => {
        noiseRafId = null;
        renderNoiseOnly();
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
    const dpr = window.devicePixelRatio || 1;

    const width = Math.floor(canvas.clientWidth * dpr);
    const height = Math.floor(canvas.clientHeight * dpr);

    if (context) {
        context.canvas.width = width;
        context.canvas.height = height;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
}

function renderSightLayer(tick: number, canvasSize: { width: number; height: number }): void {
    if (!sightCtx) return;

    sightCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    sightCtx.save();
    for (const [steamId, frame] of playerFrames) {
        drawPlayerSightOverlay(sightCtx, frame, steamId, mapMetadata, canvasSize, tick);
    }
    sightCtx.restore();
}

function renderEquipmentLayer(tick: number, canvasSize: { width: number; height: number }): void {
    if (!equipmentCtx) return;

    equipmentCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    equipmentCtx.save();
    for (const [steamId, frame] of playerFrames) {
        drawPlayerEquipment(equipmentCtx, frame, steamId, mapMetadata, canvasSize, tick);
    }
    equipmentCtx.restore();
}

function renderEquipmentOnly(): void {
    if (!browser || !equipmentCtx || !equipmentCanvas || !replayData) return;

    const playbackTick = getPlaybackTick();
    updatePlayerFrames(playbackTick);
    renderEquipmentLayer(Math.floor(playbackTick), {
        width: equipmentCanvas.clientWidth,
        height: equipmentCanvas.clientHeight,
    });
}

function renderSightOnly(): void {
    if (!browser || !sightCtx || !sightCanvas || !replayData) return;

    const playbackTick = getPlaybackTick();
    updatePlayerFrames(playbackTick);
    renderSightLayer(Math.floor(playbackTick), {
        width: sightCanvas.clientWidth,
        height: sightCanvas.clientHeight,
    });
}

function renderNoiseLayer(tick: number, canvasSize: { width: number; height: number }): void {
    if (!noiseCtx) return;
    noiseCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    drawNoiseCircles(noiseCtx, tick, mapMetadata, canvasSize);
}

function renderNoiseOnly(): void {
    if (!browser || !noiseCtx || !noiseCanvas || !replayData) return;

    const playbackTick = getPlaybackTick();
    updatePlayerFrames(playbackTick);
    renderNoiseLayer(Math.floor(playbackTick), {
        width: noiseCanvas.clientWidth,
        height: noiseCanvas.clientHeight,
    });
}

function render() {
    if (!browser || !ctx || !container || !replayData) return;

    try {
        if (sightRafId !== null) {
            cancelAnimationFrame(sightRafId);
            sightRafId = null;
        }
        if (noiseRafId !== null) {
            cancelAnimationFrame(noiseRafId);
            noiseRafId = null;
        }
        if (equipmentRafId !== null) {
            cancelAnimationFrame(equipmentRafId);
            equipmentRafId = null;
        }
        const playbackTick = getPlaybackTick();
        const tick = Math.floor(playbackTick);
        updatePlayerFrames(playbackTick);
        updateTrailCache(tick);

        const canvasSize = {
            width: container.clientWidth,
            height: container.clientHeight,
        };

        ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

        ctx.save();

        for (const [steamId] of trails) {
            const trail = getCachedTrail(steamId);
            drawPlayerTrail(ctx, trail, mapMetadata, canvasSize);
        }

        drawKillMarkers(ctx, getCachedKillsInCurrentRound(tick), mapMetadata, canvasSize, tick);
        drawBombDot(ctx, tick, mapMetadata, canvasSize);

        for (const [steamId, frame] of playerFrames) {
            drawPlayer(ctx, frame, steamId, mapMetadata, canvasSize, tick);
        }
        ctx.restore();
        renderEquipmentLayer(tick, canvasSize);
        renderNoiseLayer(tick, canvasSize);
        renderSightLayer(tick, canvasSize);
    } catch (error) {
        console.error('Error rendering player layer:', error);
    }
}

onMount(() => {
    if (!browser) return;

    if (container) {
        ctx = container.getContext('2d')!;
        resizeCanvas(container, ctx);
    }
    if (equipmentCanvas) {
        equipmentCtx = equipmentCanvas.getContext('2d')!;
        resizeCanvas(equipmentCanvas, equipmentCtx);
    }
    if (noiseCanvas) {
        noiseCtx = noiseCanvas.getContext('2d')!;
        resizeCanvas(noiseCanvas, noiseCtx);
    }
    if (sightCanvas) {
        sightCtx = sightCanvas.getContext('2d')!;
        resizeCanvas(sightCanvas, sightCtx);
    }

    try {
        if (replayData) {
            initializeTrails();
            updatePlayerFrames(getPlaybackTick());
            updateTrailCache(Math.floor(getPlaybackTick()));
            render();
        }
    } catch (error) {
        console.error('Error initializing player layer:', error);
    }

    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);
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
    void replayData;
    if (replayData && ctx) {
        initializeTrails();
        updatePlayerFrames(getPlaybackTick());
        updateTrailCache(Math.floor(getPlaybackTick()));
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        render();
    }
}

$: {
    void sightConeLength, sightConeHalfAngle, sightConeTransparencyPercent, showSightCone, sightConeForSelectedPlayer, showLineOfSight, lineOfSightLength, lineOfSightWidth;
    if (browser && sightCtx) {
        scheduleSightRender();
    }
}

$: {
    void selectedPlayerSteamId;
    if (browser && ctx) {
        scheduleRender();
    }
    if (browser && noiseCtx) {
        scheduleNoiseRender();
    }
}

$: {
    void showPlayerUtilities, showPlayerC4, showPlayerDefuseKit;
    if (browser && equipmentCtx) scheduleEquipmentRender();
}

$: {
    void showNoiseCircle, noiseForSelectedPlayer, showCtNoiseCircle, showTNoiseCircle, enabledNoiseSources;
    if (browser && noiseCtx) {
        scheduleNoiseRender();
    }
}

let resizeTimeout: ReturnType<typeof setTimeout>;
function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (container) {
            resizeCanvas(container, ctx);
        }
        if (equipmentCanvas) {
            resizeCanvas(equipmentCanvas, equipmentCtx);
        }
        if (noiseCanvas) {
            resizeCanvas(noiseCanvas, noiseCtx);
        }
        if (sightCanvas) {
            resizeCanvas(sightCanvas, sightCtx);
        }
        render();
    }, 150);
}

function handleVisibility() {
    if (document.visibilityState === 'visible') {
        render();
    }
}

onDestroy(() => {
    if (browser) {
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('visibilitychange', handleVisibility);
    }
    if (resizeTimeout) clearTimeout(resizeTimeout);
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (equipmentRafId !== null) cancelAnimationFrame(equipmentRafId);
    if (noiseRafId !== null) cancelAnimationFrame(noiseRafId);
    if (sightRafId !== null) cancelAnimationFrame(sightRafId);
    stopRenderLoop();
    unsubscribeTick?.();
});
</script>

<style>
.player-layer {
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

.player-layer.canvas {
    image-rendering: pixelated;
    image-rendering: -webkit-crisp-edges;
    image-rendering: -moz-crisp-edges;
}

.sight-layer {
    pointer-events: none;
}

.equipment-layer {
    pointer-events: none;
}

.noise-layer {
    pointer-events: none;
}
</style>

<canvas
    bind:this={noiseCanvas}
    class="player-layer noise-layer canvas"
    style="width: 100%; height: 100%;"
></canvas>

<canvas 
    bind:this={container}
    class="player-layer canvas"
    style="width: 100%; height: 100%;"
></canvas>

<canvas
    bind:this={equipmentCanvas}
    class="player-layer equipment-layer canvas"
    style="width: 100%; height: 100%;"
></canvas>

<canvas
    bind:this={sightCanvas}
    class="player-layer sight-layer canvas"
    style="width: 100%; height: 100%;"
></canvas>
