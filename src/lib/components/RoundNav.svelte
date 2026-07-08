<script lang="ts">
import type { ReplayData, RoundData } from '$lib/types/replay/replay_pb';

export let replayData: ReplayData | null = null;
export let currentTick = 0;
export let onseekround: (round: RoundData) => void = () => {};

let rounds: RoundData[] = [];
let roundBtns: HTMLButtonElement[] = [];

function getCurrentRoundData(): RoundData | null {
    if (!rounds.length) return null;
    for (const round of rounds) {
        if (currentTick >= round.startTick && currentTick <= round.endTick) {
            return round;
        }
    }
    return null;
}

function getCurrentRound(): number {
    return getCurrentRoundData()?.roundNumber ?? 0;
}

function updateActiveRound(): void {
    const activeRound = getCurrentRound();
    for (let i = 0; i < roundBtns.length; i++) {
        const btn = roundBtns[i];
        const round = rounds[i];
        if (btn && round) {
            btn.classList.toggle('active', round.roundNumber === activeRound);
        }
    }
}

$: {
    void replayData;
    if (!replayData?.rounds) {
        rounds = [];
    } else {
        rounds = [...replayData.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
    }
}

let lastActiveRound = -1;

$: {
    void currentTick;
    if (roundBtns.length > 0) {
        const current = getCurrentRound();
        if (current !== lastActiveRound) {
            lastActiveRound = current;
            updateActiveRound();
        }
    }
}
</script>

<style>
.round-nav {
    position: absolute;
    bottom: 80px;
    right: 20px;
    background: #1a1a24;
    border: 1px solid #2a2a40;
    border-radius: 8px;
    padding: 12px;
    z-index: 100;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
}

.round-nav-title {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 8px;
}

.round-button {
    display: block;
    width: 100%;
    padding: 6px 10px;
    margin-bottom: 4px;
    background: #2a2a40;
    border: none;
    border-radius: 4px;
    color: #e2e8f0;
    text-align: left;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.1s ease;
}

.round-button:hover {
    background: #3b82f6;
}

.round-button.active {
    background: #2563eb;
    color: #ffffff;
}
</style>

<div class="round-nav">
    <div class="round-nav-title">Rounds</div>
    {#each rounds as round, i (round.roundNumber)}
        <button
            bind:this={roundBtns[i]}
            class="round-button"
            onclick={() => onseekround(round)}
        >
            Round {round.roundNumber} ({round.winnerTeam === 2 ? 'T' : 'CT'} {round.killCount > 0 ? `+${round.killCount}` : ''})
        </button>
    {/each}
</div>
