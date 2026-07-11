<script lang="ts">
import { shortcutBindingsStore, shortcutForDisplay } from '$lib/shortcuts';

export let actionId: string;
export let shortcut = '';
export let isCapturing = false;
export let emptyIcon: 'plus' | 'minus' = 'plus';
export let oncapture: (actionId: string) => void;
export let onremove: (actionId: string) => void;

let displayedShortcut = '';
$: {
    void shortcut;
    displayedShortcut = $shortcutBindingsStore[actionId] ?? '';
}
</script>

<div class="shortcut-binding" data-shortcut-editor>
    {#if isCapturing}
        <kbd class="shortcut-key capturing">Press input · Esc cancels</kbd>
    {:else if displayedShortcut}
        <button
            type="button"
            class="shortcut-key-button"
            aria-label="Edit shortcut"
            title={`Edit shortcut: ${shortcutForDisplay(displayedShortcut)}`}
            onclick={() => oncapture(actionId)}
        >
            <kbd class="shortcut-key">{shortcutForDisplay(displayedShortcut)}</kbd>
        </button>
        <button
            type="button"
            class="shortcut-icon remove"
            aria-label="Remove shortcut"
            title="Remove shortcut"
            onclick={() => onremove(actionId)}
        >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
    {:else}
        <button
            type="button"
            class="shortcut-add"
            aria-label={emptyIcon === 'minus' ? 'Add decrease shortcut' : 'Add shortcut'}
            title={emptyIcon === 'minus' ? 'Add decrease shortcut' : 'Add shortcut'}
            onclick={() => oncapture(actionId)}
        >
            {#if emptyIcon === 'minus'}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
            {:else}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            {/if}
        </button>
    {/if}
</div>

<style>
.shortcut-binding {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 34px;
    flex: 0 0 auto;
}

.shortcut-key {
    display: inline-flex;
    height: 26px;
    max-width: 150px;
    align-items: center;
    justify-content: center;
    padding: 0 9px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.46);
    border-bottom-color: rgba(148, 163, 184, 0.78);
    border-radius: 5px;
    background: linear-gradient(180deg, #303044 0%, #20202f 48%, #171721 100%);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.1),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35),
        0 2px 0 #0b0b11,
        0 3px 6px rgba(0, 0, 0, 0.26);
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.025em;
    line-height: 1;
    text-overflow: ellipsis;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.7);
    white-space: nowrap;
}

.shortcut-key.capturing {
    border-color: #60a5fa;
    background: linear-gradient(180deg, #263d5f 0%, #1c304e 100%);
    color: #bfdbfe;
    animation: capture-pulse 1s ease-in-out infinite alternate;
}

.shortcut-key-button {
    display: inline-flex;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
}

.shortcut-key-button:hover .shortcut-key,
.shortcut-key-button:focus-visible .shortcut-key {
    border-color: #60a5fa;
    background: linear-gradient(180deg, #3a4961 0%, #25364d 52%, #18263a 100%);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.14),
        0 2px 0 #0b0b11,
        0 3px 9px rgba(59, 130, 246, 0.28);
    color: #eff6ff;
}

.shortcut-key-button:focus-visible {
    outline: 2px solid #93c5fd;
    outline-offset: 2px;
}

.shortcut-icon,
.shortcut-add {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: #94a3b8;
}

.shortcut-add {
    border-color: rgba(148, 163, 184, 0.34);
    background: rgba(42, 42, 64, 0.7);
}

.shortcut-icon:hover,
.shortcut-icon:focus-visible,
.shortcut-add:hover,
.shortcut-add:focus-visible {
    border-color: #60a5fa;
    background: rgba(59, 130, 246, 0.18);
    color: #e2e8f0;
}

.shortcut-icon.remove:hover,
.shortcut-icon.remove:focus-visible {
    border-color: #f87171;
    background: rgba(239, 68, 68, 0.14);
    color: #fecaca;
}

svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
}

@keyframes capture-pulse {
    from { box-shadow: 0 0 0 rgba(96, 165, 250, 0); }
    to { box-shadow: 0 0 10px rgba(96, 165, 250, 0.28); }
}

@media (prefers-reduced-motion: reduce) {
    .shortcut-key.capturing { animation: none; }
}
</style>
