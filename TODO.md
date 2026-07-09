# TODOs

These items were requested for implementation and are now complete in the current working tree.

## Implemented Changes

- Added a compact `Sight Cone Controls` header above the top-left sight controls.
- Increased the sight cone length slider maximum from `80` to `240`, while keeping the default length unchanged.
- Added `Show Line of Sight` and a separate line-of-sight length slider with range `18` to `800`.
- Updated round button `+N` text to mean surviving players on the winning side at round end.
- Color-coded round buttons by winner: CT blue, T orange, with a distinct active outline.
- Removed previous/next kill buttons and removed left/right arrow seek behavior.
- Highlighted the selected player on the map; selected alive players use green for dot, sight cone, and line of sight.
- Clicking the currently selected player again now clears selection, and selected-player timeline markers are cached to avoid playback lag.
- Added a `Player Selection` section with `Zoom Selected Player` and a zoom slider up to `500%`; zoom is now a viewport-level visual CSS transform, not a canvas-layer logic transform.
- Added double-click copy on timeline markers. It copies `demo_goto <tick>`, using event tick minus 2 seconds and clamping within the event round.
- Added parser-backed flash events and grey fading flash circles around flashed players.
- Added parser-backed noise radius events and transparent red noise rings around alive players making noise.
- Made kill feed rows clickable. Clicking selects the killer and seeks to 2 seconds before the kill.
- Added alive/total counts to team roster headers, e.g. `CT (3/5)` and `T (1/5)`.
- Added parser-backed bomb lifecycle events and centered bomb/defuse status labels.
- Added `BE` and `BD` timeline markers for bomb explosion and defuse outcomes.

## Notes

- Demos need to be parsed again from the original `.dem` file to populate the new `flashes`, `noises`, and `bombs` protobuf arrays.
- `pnpm tauri dev` and `npx @sveltejs/mcp svelte-autofixer` are intentionally manual-only commands for this project.
