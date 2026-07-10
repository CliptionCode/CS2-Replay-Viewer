<script lang="ts">
export let isPlaying = false;
export let playbackSpeed = 1;
export let isLoading = false;
export let speedOptions: number[] = [0.5, 1, 2, 3];
export let hasLowerMapVariant = false;
export let mapVariant: 'default' | 'lower' = 'default';
export let ontoggleplay: () => void;
export let onsetspeed: (speed: number) => void;
export let onloaddemo: () => void = () => {};
export let onsetmapvariant: (variant: 'default' | 'lower') => void = () => {};

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

.load-demo-button {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
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
    <button class="load-demo-button" onclick={onloaddemo} disabled={isLoading}>
        {isLoading ? 'Loading...' : 'Load Demo'}
    </button>
    <button bind:this={playBtn} class="control-button" onclick={ontoggleplay}>▶</button>
    <div class="speed-group">
        <span class="speed-label">Speed</span>
        {#each speedOptions as speed, i}
            <button bind:this={speedBtnEls[i]} class="speed-button" onclick={() => onsetspeed(speed)}>{speed}x</button>
        {/each}
    </div>
    {#if hasLowerMapVariant}
        <div class="speed-group">
            <span class="speed-label">Map</span>
            <button
                class="speed-button"
                class:active={mapVariant === 'default'}
                onclick={() => onsetmapvariant('default')}
            >
                Normal
            </button>
            <button
                class="speed-button"
                class:active={mapVariant === 'lower'}
                onclick={() => onsetmapvariant('lower')}
            >
                Lower
            </button>
        </div>
    {/if}
</div>
