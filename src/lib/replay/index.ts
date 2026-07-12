import type { PlayerFrame, ReplayData, RoundData } from '$lib/types/replay/replay_pb';

export type FrameIndex = Map<bigint, PlayerFrame[]>;

export function indexFrames(replay: ReplayData): FrameIndex {
  const index: FrameIndex = new Map();
  for (const frame of replay.frames) {
    const list = index.get(frame.steamId);
    if (list) list.push(frame);
    else index.set(frame.steamId, [frame]);
  }
  for (const frames of index.values()) frames.sort((a, b) => a.tick - b.tick);
  return index;
}

export function roundStart(round: RoundData): number {
  return round.freezetimeEndTick > round.startTick ? round.freezetimeEndTick : round.startTick;
}

export function frameAt(frames: PlayerFrame[], tick: number): [PlayerFrame, PlayerFrame, number] | null {
  if (!frames.length || tick < frames[0].tick || tick > frames[frames.length - 1].tick) return null;
  let low = 0;
  let high = frames.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (frames[mid].tick <= tick) low = mid + 1;
    else high = mid - 1;
  }
  const a = frames[Math.max(0, high)];
  const b = frames[Math.min(frames.length - 1, high + 1)];
  const span = b.tick - a.tick;
  return [a, b, span > 0 ? (tick - a.tick) / span : 0];
}

export function lerpAngleDegrees(a: number, b: number, alpha: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return a + delta * alpha;
}
