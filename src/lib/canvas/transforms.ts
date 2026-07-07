// lib/canvas/transforms.ts - Coordinate system utilities

export interface MapData {
    name: string;
    posX: number;
    posY: number;
    scale: number;
    rotate: number;
    zoom: number;
    width: number;
    height: number;
}

export interface CanvasSize {
    width: number;
    height: number;
}

/**
 * Convert CS2 world coordinates to canvas pixel coordinates.
 * 
 * CS2 uses a right-handed Z-up coordinate system:
 * - X axis: East-West (positive = East)
 * - Y axis: North-South (positive = North) 
 * - Z axis: Height (positive = up)
 *
 * Screen coordinates use Y-down for north.
 * Formula: radarX = (worldX - posX) / scale
 * Formula: radarY = (posY - worldY) / scale (Y axis is inverted!)
 */
const MAP_MARGIN = 0.88;

function computeDisplayScale(mapData: MapData, canvasSize: CanvasSize): number {
    const scaleX = canvasSize.width / (mapData.width || 1024);
    const scaleY = canvasSize.height / (mapData.height || 1024);
    return Math.min(scaleX, scaleY) * MAP_MARGIN;
}

export function worldToCanvas(
    worldX: number, 
    worldY: number,
    mapData: MapData,
    canvasSize: CanvasSize,
    containerX: number = 0,
    containerY: number = 0,
    imgOffsetX: number = 0,
    imgOffsetY: number = 0,
    imgScaleX: number = 1,
    imgScaleY: number = 1
): { x: number; y: number } {
    // Convert world units to radar pixel coordinates (0 = left/top edge of radar image)
    let px = (worldX - mapData.posX) / mapData.scale;
    let py = (mapData.posY - worldY) / mapData.scale; // Y is inverted

    // Scale to fit canvas (same approach as MapLayer's calculateMapCanvasSize)
    const baseDisplayScale = computeDisplayScale(mapData, canvasSize);
    const displayScaleX = baseDisplayScale * imgScaleX;
    const displayScaleY = baseDisplayScale * imgScaleY;
    const displayWidth = (mapData.width || 1024) * displayScaleX;
    const displayHeight = (mapData.height || 1024) * displayScaleY;

    px = px * displayScaleX;
    py = py * displayScaleY;

    // Apply rotation if map is rotated (most are not)
    if (mapData.rotate !== 0) {
        const rad = mapData.rotate * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rx = px * cos - py * sin;
        const ry = px * sin + py * cos;
        px = rx;
        py = ry;
    }

    // Center in canvas + image alignment offset
    const offsetX = (canvasSize.width - displayWidth) / 2 + imgOffsetX;
    const offsetY = (canvasSize.height - displayHeight) / 2 + imgOffsetY;

    return {
        x: px + offsetX + containerX,
        y: py + offsetY + containerY
    };
}

/**
 * Inverse: canvas pixel coordinates to CS2 world coordinates.
 */
export function canvasToWorld(
    canvasX: number,
    canvasY: number,
    mapData: MapData,
    canvasSize: CanvasSize,
    containerX: number = 0,
    containerY: number = 0,
    imgOffsetX: number = 0,
    imgOffsetY: number = 0,
    imgScaleX: number = 1,
    imgScaleY: number = 1
): { x: number; y: number } {
    const baseDisplayScale = computeDisplayScale(mapData, canvasSize);
    const displayScaleX = baseDisplayScale * imgScaleX;
    const displayScaleY = baseDisplayScale * imgScaleY;
    const displayWidth = (mapData.width || 1024) * displayScaleX;
    const displayHeight = (mapData.height || 1024) * displayScaleY;

    const offsetX = (canvasSize.width - displayWidth) / 2 + imgOffsetX;
    const offsetY = (canvasSize.height - displayHeight) / 2 + imgOffsetY;

    // Remove centering offset and undo display scaling
    let px = (canvasX - offsetX - containerX) / displayScaleX;
    let py = (canvasY - offsetY - containerY) / displayScaleY;

    // Reverse rotation
    if (mapData.rotate !== 0) {
        const rad = -mapData.rotate * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rx = px * cos - py * sin;
        const ry = px * sin + py * cos;
        px = rx;
        py = ry;
    }

    // Convert radar pixels to world units
    const worldX = px * mapData.scale + mapData.posX;
    const worldY = mapData.posY - py * mapData.scale;

    return { x: worldX, y: worldY };
}

export function formatTime(tick: number, tickRate: number = 64): string {
    const seconds = tick / tickRate;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    if (minutes > 0) {
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${remainingSeconds}s`;
}

export function interpolatePosition(
    fromX: number, fromY: number,
    toX: number, toY: number,
    factor: number
): { x: number; y: number } {
    return {
        x: fromX + (toX - fromX) * factor,
        y: fromY + (toY - fromY) * factor
    };
}
