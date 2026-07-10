<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { ReplayRenderer } from '$lib/canvas/renderer';
import type { MapData, ReplayData } from '$lib/types/replay/replay_pb';

export let container: HTMLElement | null = null;
export let replayData: ReplayData | null = null;
export let isPlaying: boolean = false;
export let currentTick: number = 0;
export let mapMetadata: MapData;

let renderer: ReplayRenderer;

onMount(() => {
    if (!browser) return;

    if (container && mapMetadata) {
        renderer = new ReplayRenderer(container, mapMetadata, replayData || undefined);
    }

    window.addEventListener('resize', handleResize);

    return () => {
        if (renderer) {
            renderer.destroy();
        }
        window.removeEventListener('resize', handleResize);
    };
});

export function setPlaying(value: boolean) {
    renderer?.setPlaying(value);
}

export function seekToTick(tick: number) {
    renderer?.setTick(tick);
}
</script>

<style>
.canvas-container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0f0f13;
}

.canvas-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}
</style>

<div class="canvas-container" bind:this={container}>
    <!-- Canvas layers will be dynamically added by the renderer -->
</div>
