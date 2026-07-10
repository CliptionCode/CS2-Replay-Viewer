let playbackTick = 0;

const tickListeners = new Set<() => void>();

export function getPlaybackTick(): number {
    return playbackTick;
}

export function setPlaybackTick(tick: number): void {
    playbackTick = Number.isFinite(tick) ? Math.max(0, tick) : 0;
}

export function notifyPlaybackTickChanged(): void {
    for (const listener of tickListeners) {
        listener();
    }
}

export function setPlaybackTickAndNotify(tick: number): void {
    setPlaybackTick(tick);
    notifyPlaybackTickChanged();
}

export function subscribePlaybackTick(listener: () => void): () => void {
    tickListeners.add(listener);
    return () => {
        tickListeners.delete(listener);
    };
}
