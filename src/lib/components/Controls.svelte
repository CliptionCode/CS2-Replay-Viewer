<script lang="ts">
import ShortcutBinding from './ShortcutBinding.svelte';

export let isPlaying = false;
export let playbackSpeed = 1;
export let isLoading = false;
export let speedOptions: number[] = [0.5, 1, 2, 3];
export let hasLowerMapVariant = false;
export let mapVariant: 'default' | 'lower' = 'default';
export let viewMode: '2d' | '3d' = '2d';
export let ontoggleplay: () => void;
export let onsetspeed: (speed: number) => void;
export let onloaddemo: () => void = () => {};
export let onsetmapvariant: (variant: 'default' | 'lower') => void = () => {};
export let onsetviewmode: (mode: '2d' | '3d') => void = () => {};
export let getshortcut: (actionId: string) => string = () => '';
export let capturingActionId: string | null = null;
export let onshortcutcapture: (actionId: string) => void = () => {};
export let onshortcutremove: (actionId: string) => void = () => {};

let playBtn: HTMLButtonElement | undefined;
let speedBtnEls: HTMLButtonElement[] = [];

$: {
    void isPlaying;
    if (playBtn) {
        playBtn.textContent = isPlaying ? '⏸' : '▶';
    }
}

$: {
    void playbackSpeed;
    for (let i = 0; i < speedBtnEls.length; i++) {
        const btn = speedBtnEls[i];
        if (btn) {
            btn.classList.toggle('active', speedOptions[i] === playbackSpeed);
        }
    }
}
</script>

<style>
.controls {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: #1a1a24;
    border-top: 1px solid #2a2a40;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    z-index: 100;
}

.control-button {
    width: 40px;
    height: 40px;
    background: #2a2a40;
    border: none;
    border-radius: 50%;
    color: #e2e8f0;
    font-size: 18px;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
}

.control-button:hover {
    background: #3b82f6;
    transform: scale(1.05);
}

.control-button:active {
    transform: scale(0.95);
}

.control-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.load-demo-control {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 5px;
}

.load-demo-button {
    height: 34px;
    padding: 0 14px;
    background: #2a2a40;
    border: 1px solid #3a3a50;
    border-radius: 4px;
    color: #e2e8f0;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 700;
    transition: all 0.15s ease;
}

.control-with-shortcut {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

:global(.controls .shortcut-key) {
    max-width: 74px;
}

.load-demo-button:hover {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #ffffff;
}

.load-demo-button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.speed-group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 12px;
    padding-left: 12px;
    border-left: 1px solid #2a2a40;
}

.speed-label {
    font-size: 12px;
    color: #94a3b8;
    font-weight: 500;
}

.speed-button {
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
    background: #2a2a40;
    border: 1px solid #3a3a50;
    border-radius: 4px;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
}

.speed-button:hover {
    background: #3a3a50;
    color: #e2e8f0;
}

:global(.speed-button.active) {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #ffffff;
}
</style>

<div class="controls">
    <div class="load-demo-control">
        <button class="load-demo-button" onclick={onloaddemo} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Load Demo'}
        </button>
        <ShortcutBinding actionId="playback.load" shortcut={getshortcut('playback.load')} isCapturing={capturingActionId === 'playback.load'} oncapture={onshortcutcapture} onremove={onshortcutremove} />
    </div>
    <div class="control-with-shortcut">
        <button bind:this={playBtn} class="control-button" onclick={ontoggleplay}>▶</button>
        <ShortcutBinding actionId="playback.toggle" shortcut={getshortcut('playback.toggle')} isCapturing={capturingActionId === 'playback.toggle'} oncapture={onshortcutcapture} onremove={onshortcutremove} />
    </div>
    <div class="speed-group">
        <span class="speed-label">Speed</span>
        {#each speedOptions as speed, i}
            <button bind:this={speedBtnEls[i]} class="speed-button" onclick={() => onsetspeed(speed)}>{speed}x</button>
        {/each}
    </div>
    <div class="speed-group">
        <span class="speed-label">View</span>
        <button class="speed-button" class:active={viewMode === '2d'} onclick={() => onsetviewmode('2d')}>2D</button>
        <button class="speed-button" class:active={viewMode === '3d'} onclick={() => onsetviewmode('3d')}>3D</button>
    </div>
    {#if hasLowerMapVariant}
        <div class="speed-group">
            <span class="speed-label">Map</span>
            <div class="control-with-shortcut">
                <button class="speed-button" class:active={mapVariant === 'default'} onclick={() => onsetmapvariant('default')}>Normal</button>
                <ShortcutBinding actionId="map.normal" shortcut={getshortcut('map.normal')} isCapturing={capturingActionId === 'map.normal'} oncapture={onshortcutcapture} onremove={onshortcutremove} />
            </div>
            <div class="control-with-shortcut">
                <button class="speed-button" class:active={mapVariant === 'lower'} onclick={() => onsetmapvariant('lower')}>Lower</button>
                <ShortcutBinding actionId="map.lower" shortcut={getshortcut('map.lower')} isCapturing={capturingActionId === 'map.lower'} oncapture={onshortcutcapture} onremove={onshortcutremove} />
            </div>
        </div>
    {/if}
</div>
