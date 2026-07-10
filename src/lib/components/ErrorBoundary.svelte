// components/ErrorBoundary.svelte
<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import type { Snippet } from 'svelte';

interface Props {
    fallback?: Snippet<[error: Error]>;
    children?: Snippet;
}

let { fallback, children }: Props = $props();

let error: Error | null = null;

function handleError(e: any) {
    console.error('Component error:', e);
    error = e instanceof Error ? e : new Error(String(e));
}

// Handle unhandled promise rejections
function handleUnhandledRejection(event: PromiseRejectionEvent) {
    handleError(event.reason);
}

onMount(() => {
    if (!browser) return;

    window.addEventListener('error', (e) => handleError(e.error));
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
        window.removeEventListener('error', (e) => handleError(e.error));
        window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
});
</script>

{#if error && fallback}
    {@render fallback(error)}
{:else if error}
    <div class="error-boundary">
        <div class="error-content">
            <h2>Application Error</h2>
            <p>{error.message}</p>
            <button on:click={() => browser && window.location.reload()}>Retry</button>
        </div>
    </div>
{:else}
    {@render children?.()}
{/if}

<style>
.error-boundary {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    padding: 40px;
    background: #0f0f13;
    color: #e2e8f0;
}

.error-content {
    text-align: center;
    max-width: 500px;
}

.error-content h2 {
    color: #ef4444;
    margin-bottom: 16px;
}

.error-content p {
    color: #94a3b8;
    margin-bottom: 24px;
    line-height: 1.6;
}

.error-content button {
    padding: 12px 24px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    transition: background 0.15s ease;
}

.error-content button:hover {
    background: #2563eb;
}
</style>
