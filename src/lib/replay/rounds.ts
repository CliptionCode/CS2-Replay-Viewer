import type { ReplayData, RoundData } from '$lib/types/replay/replay_pb';

export const ROUND_END_DELAY_SECONDS = 7;

const ELIMINATION_WIN_REASONS = new Set(['ct_win', 't_win']);

export function getRoundEndDelayTicks(replayData: ReplayData | null | undefined): number {
    return Math.round((replayData?.header?.tickRate || 64) * ROUND_END_DELAY_SECONDS);
}

function getNextRoundStartTick(replayData: ReplayData | null | undefined, round: RoundData): number | null {
    if (!replayData?.rounds) return null;

    let nextStartTick: number | null = null;
    for (const candidate of replayData.rounds) {
        if (candidate.startTick <= round.startTick) continue;
        if (nextStartTick === null || candidate.startTick < nextStartTick) {
            nextStartTick = candidate.startTick;
        }
    }
    return nextStartTick;
}

function getBombTerminalTick(replayData: ReplayData | null | undefined, round: RoundData): number | null {
    if (!replayData?.bombs) return null;

    const eventType = round.winReason === 'bomb_detonated'
        ? 'exploded'
        : round.winReason === 'bomb_defused'
            ? 'defused'
            : '';
    if (!eventType) return null;

    const event = replayData.bombs
        .filter(bomb => bomb.eventType === eventType && bomb.tick >= round.startTick && bomb.tick <= round.endTick)
        .sort((a, b) => b.tick - a.tick)[0];

    return event?.tick ?? null;
}

function getEliminationTerminalTick(replayData: ReplayData | null | undefined, round: RoundData): number | null {
    if (!ELIMINATION_WIN_REASONS.has(round.winReason) || !replayData?.kills) return null;

    const kill = replayData.kills
        .filter(candidate => candidate.tick >= round.startTick && candidate.tick <= round.endTick)
        .sort((a, b) => b.tick - a.tick)[0];

    return kill?.tick ?? round.endTick;
}

export function getRoundTerminalTick(replayData: ReplayData | null | undefined, round: RoundData): number | null {
    return getBombTerminalTick(replayData, round) ?? getEliminationTerminalTick(replayData, round);
}

export function getRoundDisplayEndTick(replayData: ReplayData | null | undefined, round: RoundData): number {
    const delayTicks = getRoundEndDelayTicks(replayData);
    const terminalTick = getRoundTerminalTick(replayData, round);
    let endTick = round.endTick;

    if (terminalTick !== null && endTick < terminalTick + delayTicks) {
        endTick = terminalTick + delayTicks;
    }

    const nextStartTick = getNextRoundStartTick(replayData, round);
    if (nextStartTick !== null) {
        endTick = Math.min(endTick, nextStartTick - 1);
    }

    const maxReplayTick = (replayData?.header?.totalTicks ?? 0) - 1;
    if (maxReplayTick > 0) {
        endTick = Math.min(endTick, maxReplayTick);
    }

    return Math.max(round.startTick, endTick);
}

export function isTickInRound(replayData: ReplayData | null | undefined, round: RoundData, tick: number): boolean {
    return tick >= round.startTick && tick <= getRoundDisplayEndTick(replayData, round);
}

export function getRoundForTick(replayData: ReplayData | null | undefined, tick: number): RoundData | null {
    if (!replayData?.rounds) return null;
    return replayData.rounds.find(round => isTickInRound(replayData, round, tick)) ?? null;
}

export function getPlaybackStartRound(replayData: ReplayData | null | undefined, tick: number): RoundData | null {
    if (!replayData?.rounds) return null;
    return replayData.rounds.find(round => tick <= getRoundDisplayEndTick(replayData, round)) ?? null;
}
