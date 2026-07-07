// lib/canvas/renderer.ts - Low-level Canvas 2D render loop and frame scheduling

import type { ReplayData, PlayerFrame, KillEvent, NadeEvent } from '../types/replay/replay_pb';
import type { MapData as MapMetadata } from './transforms';
import { worldToCanvas, formatTime } from './transforms';

export interface RenderOptions {
    tickRate: number;
    currentTick: number;
    playbackSpeed: number;
    isPlaying: boolean;
    trailLength: number; // ticks
    smokeRadius: number;
    nadeRadius: number;
}

export interface RenderState {
    entities: {
        players: Map<string, PlayerFrame>;
        kills: KillEvent[];
        nades: NadeEvent[];
        rounds: any[];
    };
    screen: {
        width: number;
        height: number;
        centerX: number;
        centerY: number;
    };
    map: MapMetadata;
    lastFrameTime: number;
    frameCount: number;
}

export class ReplayRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private mapCanvas!: HTMLCanvasElement;
    private playerCanvas!: HTMLCanvasElement;
    private nadeCanvas!: HTMLCanvasElement;
    private killCanvas!: HTMLCanvasElement;

    private state: RenderState;
    private options: RenderOptions;

    private animationId: number | null = null;
    private lastFrameTime = 0;
    private deltaTime = 0;

    constructor(
        canvas: HTMLCanvasElement,
        mapData: MapMetadata,
        initialData: ReplayData | null = null
    ) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;

        this.options = {
            tickRate: 64,
            currentTick: 0,
            playbackSpeed: 1.0,
            isPlaying: false,
            trailLength: 128, // 2 seconds at 64 tick
            smokeRadius: 200,
            nadeRadius: 200,
        };

        this.state = {
            entities: {
                players: new Map(),
                kills: [],
                nades: [],
                rounds: [],
            },
            screen: {
                width: canvas.width,
                height: canvas.height,
                centerX: canvas.width / 2,
                centerY: canvas.height / 2,
            },
            map: mapData,
            lastFrameTime: 0,
            frameCount: 0,
        };

        this.setupLayeredCanvases();
        this.setupCanvasOptimizations();

        if (initialData) {
            this.loadData(initialData);
        }
    }

    private setupLayeredCanvases(): void {
        // Create offscreen canvases for each layer
        this.mapCanvas = this.createLayerCanvas('map');
        this.playerCanvas = this.createLayerCanvas('player');
        this.nadeCanvas = this.createLayerCanvas('nade');
        this.killCanvas = this.createLayerCanvas('kill');

        // Position canvases absolutely over the main canvas
        this.mapCanvas.style.position = 'absolute';
        this.playerCanvas.style.position = 'absolute';
        this.nadeCanvas.style.position = 'absolute';
        this.killCanvas.style.position = 'absolute';

        this.updateCanvasPositions();
    }

    private createLayerCanvas(id: string): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.id = `layer-${id}`;
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.left = '0';
        canvas.style.top = '0';

        this.canvas.parentElement?.appendChild(canvas);
        return canvas;
    }

    private setupCanvasOptimizations(): void {
        // Optimize for redraw performance
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.textBaseline = 'middle';
        this.ctx.textAlign = 'center';
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        // Pre-calculate transforms
        this.state.map = this.calculateMapTransform();
    }

    private calculateMapTransform(): MapMetadata {
        const { map } = this.state;
        const { width, height } = this.state.screen;

        return {
            ...map,
            // Apply zoom if needed
            scale: map.scale * (map.zoom || 1),
            width: map.width * (map.zoom || 1),
            height: map.height * (map.zoom || 1),
            // Center in canvas
            posX: map.posX + (width - map.width * (map.zoom || 1)) / (2 * map.scale),
            posY: map.posY + (height - map.height * (map.zoom || 1)) / (2 * map.scale),
        };
    }

    public loadData(data: ReplayData): void {
        // Update player frames
        this.state.entities.players.clear();
        for (const frame of data.frames) {
            this.state.entities.players.set(frame.steamId.toString(), frame);
        }

        // Update kills and nades
        this.state.entities.kills = data.kills;
        this.state.entities.nades = data.nades;
        this.state.entities.rounds = data.rounds;

        // Set current tick to start of first round
        if (data.rounds.length > 0) {
            this.options.currentTick = data.rounds[0].startTick;
        }

        // Redraw immediately
        this.renderFrame();
    }

    public setTick(tick: number): void {
        if (tick !== this.options.currentTick) {
            this.options.currentTick = tick;
            this.renderFrame();
        }
    }

    public setPlaying(isPlaying: boolean): void {
        this.options.isPlaying = isPlaying;
        if (isPlaying) {
            this.lastFrameTime = performance.now();
            this.loop(this.lastFrameTime);
        } else {
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
            }
        }
    }

    public setPlaybackSpeed(speed: number): void {
        this.options.playbackSpeed = speed;
    }

    private loop(timestamp: number): void {
        if (!this.options.isPlaying) return;

        this.deltaTime += (timestamp - this.lastFrameTime) * this.options.playbackSpeed / 1000;
        this.lastFrameTime = timestamp;

        if (this.deltaTime >= 1) {
            const tickDelta = Math.floor(this.deltaTime);
            this.options.currentTick += tickDelta;
            this.deltaTime -= tickDelta;
            this.renderFrame();
        }

        this.animationId = requestAnimationFrame((ts) => this.loop(ts));
    }

    public destroy(): void {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        // Clean up canvas layers
        this.mapCanvas.remove();
        this.playerCanvas.remove();
        this.nadeCanvas.remove();
        this.killCanvas.remove();
    }

    private renderFrame(): void {
        // Update transformed player positions
        this.updatePlayerPositions();

        // Render each layer
        this.renderMapLayer();
        this.renderPlayerLayer();
        this.renderNadeLayer();
        this.renderKillLayer();

        this.state.frameCount++;
    }

    private updatePlayerPositions(): void {
        // Get current player positions from frames at current tick
        const currentTick = this.options.currentTick;
        const players = this.state.entities.players;

        for (const [_, frame] of players) {
            // For now, just use current frame. In v2, interpolate between frames.
        }
    }

    private renderMapLayer(): void {
        const ctx = this.mapCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);

        // Draw map background (placeholder - in v2 load actual PNG)
        ctx.fillStyle = '#1e1e28';
        ctx.fillRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);

        // Draw grid lines for better visibility
        ctx.strokeStyle = '#2a2a40';
        ctx.lineWidth = 1;

        const gridSize = this.mapCanvas.width / 20;
        for (let x = 0; x <= this.mapCanvas.width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.mapCanvas.height);
            ctx.stroke();
        }

        for (let y = 0; y <= this.mapCanvas.height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.mapCanvas.width, y);
            ctx.stroke();
        }
    }

    private renderPlayerLayer(): void {
        const ctx = this.playerCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, this.playerCanvas.width, this.playerCanvas.height);

        for (const [_, frame] of this.state.entities.players) {
            const pos = worldToCanvas(frame.x, frame.y, this.state.map, this.state.screen);

            // Draw player dot
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = frame.isAlive ? '#4ade80' : '#ef4444'; // CT green / T red
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw player name above dot
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '12px Inter, sans-serif';
            ctx.fillText(frame.weapon || 'Unknown', pos.x, pos.y - 10);
        }
    }

    private renderNadeLayer(): void {
        const ctx = this.nadeCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, this.nadeCanvas.width, this.nadeCanvas.height);

        for (const nade of this.state.entities.nades) {
            const pos = worldToCanvas(nade.startX, nade.startY, this.state.map, this.state.screen);

            // Draw nade trajectory (arc)
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, this.options.nadeRadius, 0, Math.PI * 2);
            ctx.strokeStyle = this.getNadeColor(nade.nadeType);
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw effect zone (binary circle)
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, this.options.smokeRadius, 0, Math.PI * 2);
            ctx.fillStyle = this.getNadeFillColor(nade.nadeType, nade.detonationTick || 0);
            ctx.globalAlpha = 0.3;
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }
    }

    private renderKillLayer(): void {
        const ctx = this.killCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, this.killCanvas.width, this.killCanvas.height);

        // Draw death markers (crosshair) for recent kills
        const recentKills = this.state.entities.kills.filter(k => 
            k.tick >= this.options.currentTick - 64 && k.tick <= this.options.currentTick
        );

        for (const kill of recentKills) {
            const pos = worldToCanvas(kill.victimX, kill.victimY, this.state.map, this.state.screen);

            // Draw X marker
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(pos.x - 8, pos.y - 8);
            ctx.lineTo(pos.x + 8, pos.y + 8);
            ctx.moveTo(pos.x + 8, pos.y - 8);
            ctx.lineTo(pos.x - 8, pos.y + 8);
            ctx.stroke();
        }

        // Draw kill feed text
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 14px Inter, sans-serif';
        const maxLines = 5;
        const lines = this.state.entities.kills
            .slice(-maxLines)
            .map(k => {
                const killer = this.state.entities.players.get(k.killerSteamId.toString());
                const victim = this.state.entities.players.get(k.victimSteamId.toString());
                return `${killer ? killer.name : 'BOT'} [${k.weapon} ${k.isHeadshot ? '(HS)' : ''}] ${victim ? victim.name : 'BOT'}`;
            });

        let y = this.killCanvas.height - 30;
        ctx.textAlign = 'left';
        for (const line of lines) {
            ctx.fillText(line, 20, y);
            y -= 25;
        }
    }

    private getNadeColor(nadeType: string): string {
        const colors: Record<string, string> = {
            smoke: '#9ca3af',
            hegrenade: '#f97316',
            flashbang: '#fde047',
            molotov: '#dc2626',
            incendiary: '#dc2626',
            decoy: '#60a5fa',
        };
        return colors[nadeType] || '#ffffff';
    }

    private getNadeFillColor(nadeType: string, detonationTick: number): string {
        const baseColor = this.getNadeColor(nadeType);
        if (nadeType === 'smoke') {
            return 'rgba(156, 163, 175, 0.2)';
        } else if (nadeType === 'flashbang' && detonationTick > this.options.currentTick - 3) {
            return 'rgba(253, 224, 71, 0.2)';
        }
        return 'rgba(0, 0, 0, 0)';
    }

    private updateCanvasPositions(): void {
        const parent = this.canvas.parentElement;
        if (!parent) return;

        const { width, height } = this.state.screen;
        const rect = parent.getBoundingClientRect();

        this.mapCanvas.style.width = `${width}px`;
        this.mapCanvas.style.height = `${height}px`;
        this.mapCanvas.width = width;
        this.mapCanvas.height = height;

        this.playerCanvas.style.width = `${width}px`;
        this.playerCanvas.style.height = `${height}px`;
        this.playerCanvas.width = width;
        this.playerCanvas.height = height;

        this.nadeCanvas.style.width = `${width}px`;
        this.nadeCanvas.style.height = `${height}px`;
        this.nadeCanvas.width = width;
        this.nadeCanvas.height = height;

        this.killCanvas.style.width = `${width}px`;
        this.killCanvas.style.height = `${height}px`;
        this.killCanvas.width = width;
        this.killCanvas.height = height;
    }

    public resize(): void {
        const parent = this.canvas.parentElement;
        if (!parent) return;

        const rect = parent.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // Update main canvas
        const width = Math.floor(rect.width * dpr);
        const height = Math.floor(rect.height * dpr);

        this.canvas.width = width;
        this.canvas.height = height;

        // Update layer canvases
        this.updateCanvasPositions();
        this.renderFrame();
    }
}
