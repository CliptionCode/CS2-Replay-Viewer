<script lang="ts">
export let currentTick = 0;
export let activeStart = 0;

function formatTime(tick: number, tickRate: number = 64): string {
    const seconds = tick / tickRate;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    if (minutes > 0) {
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${remainingSeconds}s`;
}
</script>

<style>
.time-display {
    position: absolute;
    top: calc(var(--timeline-height, 86px) + 10px);
    left: 20px;
    background: rgba(26, 26, 36, 0.8);
    border: 1px solid #2a2a40;
    border-radius: 6px;
    padding: 8px 12px;
    color: #e2e8f0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    z-index: 100;
}
</style>

<div class="time-display">
    {formatTime(currentTick - activeStart)}
</div>
