<script lang="ts">
import type { PlayerFrame, PlayerInfo, ReplayData, RoundData } from '$lib/types/replay/replay_pb';
import { getRoundDisplayEndTick, isTickInRound } from '$lib/replay/rounds';

export let replayData: ReplayData | null = null;
export let currentTick = 0;
export let onseekround: (round: RoundData) => void = () => {};

let rounds: RoundData[] = [];
let playerFrameTrails = new Map<string, PlayerFrame[]>();

const TEAM_T = 2;
const TEAM_CT = 3;

function getCurrentRoundData(): RoundData | null {
    if (!rounds.length) return null;
    return rounds.find(round => isTickInRound(replayData, round, currentTick)) ?? null;
}

function getCurrentRound(): number {
    return getCurrentRoundData()?.roundNumber ?? 0;
}

function rebuildPlayerFrameIndex(): void {
    playerFrameTrails.clear();
    if (!replayData?.frames) return;

    for (const frame of replayData.frames) {
        const steamId = frame.steamId.toString();
        if (!playerFrameTrails.has(steamId)) {
            playerFrameTrails.set(steamId, []);
        }
        playerFrameTrails.get(steamId)?.push(frame);
    }
}

function getPlayerTeamForRound(player: PlayerInfo, round: RoundData): number {
    if (player.team !== TEAM_T && player.team !== TEAM_CT) return 0;

    const halfSize = round.roundNumber <= 24 ? 12 : 3;
    const halfIndex = Math.floor((round.roundNumber - 1) / halfSize);
    const shouldFlipStoredSide = halfIndex % 2 === 0;

    if (shouldFlipStoredSide) {
        if (player.team === TEAM_T) return TEAM_CT;
        if (player.team === TEAM_CT) return TEAM_T;
    }

    return player.team;
}

function getPlayerFrameAtOrBefore(steamId: bigint, tick: number): PlayerFrame | null {
    const trail = playerFrameTrails.get(steamId.toString());
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

function getSurvivorCounts(round: RoundData): { t: number; ct: number } {
    const counts = { t: 0, ct: 0 };
    if (!replayData?.players) return counts;

    for (const player of replayData.players) {
        const side = getPlayerTeamForRound(player, round);
        if (side !== TEAM_T && side !== TEAM_CT) continue;

        const frame = getPlayerFrameAtOrBefore(player.steamId, getRoundDisplayEndTick(replayData, round));
        if (!(frame?.isAlive ?? false)) continue;

        if (side === TEAM_T) counts.t++;
        if (side === TEAM_CT) counts.ct++;
    }

    return counts;
}

function getSurvivorLabel(round: RoundData): string {
    const counts = getSurvivorCounts(round);
    const parts: string[] = [];

    if (counts.t > 0) parts.push(`T + ${counts.t}`);
    if (counts.ct > 0) parts.push(`CT + ${counts.ct}`);
    if (parts.length === 0) return 'No Survivors';

    return parts.join(' | ');
}

function getWinnerClass(round: RoundData): string {
    if (round.winnerTeam === TEAM_T) return 'winner-t';
    if (round.winnerTeam === TEAM_CT) return 'winner-ct';
    return 'winner-neutral';
}

$: {
    void replayData;
    if (!replayData?.rounds) {
        rounds = [];
    } else {
        rounds = [...replayData.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
    }
    rebuildPlayerFrameIndex();
}
</script>

<style>
.round-nav {
    position: absolute;
    top: 360px;
    bottom: 80px;
    right: 20px;
    background: #1a1a24;
    border: 1px solid #2a2a40;
    border-radius: 8px;
    padding: 12px;
    z-index: 100;
    overflow-y: auto;
}

.round-nav-title {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 8px;
}

.round-button {
    --round-highlight-color: #94a3b8;
    display: block;
    width: 100%;
    padding: 6px 10px;
    margin-bottom: 4px;
    background: #2a2a40;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: #ffffff;
    text-align: left;
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    transition: all 0.1s ease;
}

.round-button:hover,
.round-button:focus-visible {
    position: relative;
    outline: 2px solid #ffffff;
    outline-offset: 2px;
    filter: brightness(1.3) drop-shadow(0 0 6px var(--round-highlight-color));
    transform: scale(1.04);
    z-index: 2;
}

.round-button.winner-ct {
    --round-highlight-color: #3b82f6;
    background: rgba(37, 99, 235, 0.72);
}

.round-button.winner-t {
    --round-highlight-color: #f97316;
    background: rgba(234, 88, 12, 0.78);
}

.round-button.winner-neutral {
    --round-highlight-color: #94a3b8;
    background: #374151;
}

.round-button.active {
    border-color: #ffffff;
    box-shadow: 0 0 0 2px #f8fafc, inset 0 0 0 1px rgba(15, 23, 42, 0.55);
}
</style>

<div class="round-nav">
    <div class="round-nav-title">Rounds</div>
    {#each rounds as round (round.roundNumber)}
        <button
            class="round-button {getWinnerClass(round)}"
            class:active={round.roundNumber === getCurrentRound()}
            onclick={() => onseekround(round)}
        >
            Round {round.roundNumber} ({getSurvivorLabel(round)})
        </button>
    {/each}
</div>
