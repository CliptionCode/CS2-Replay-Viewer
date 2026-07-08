# TODOs

These items are notes for future implementation. Do not implement them until explicitly requested.

## 1. Add Sight Cone Controls Header

Add a section header above the existing top-left sight cone controls with the text `Sight Cone Controls`.

Approach:
- Update the controls block in `src/routes/+page.svelte`.
- Keep the header visually compact so it does not collide with the time display or map content.
- Reuse the existing panel styling rather than adding a separate floating card.

## 2. Increase Sight Cone Max Length

The current sight cone length slider max value is `80`. Increase the maximum to `240`.

Approach:
- Adjust only the slider range in the sight cone controls.
- Keep the existing default length unchanged.
- Confirm the player-layer cone rendering already accepts the larger value without additional transform changes.

## 3. Add Show Line of Sight Checkbox

Add a checkbox labeled `Show Line of Sight` beneath the sight cone controls. When enabled, draw a line from each alive player in their current look direction. The line should use the player's side color: CT blue, T orange. When disabled, do not draw line of sight.

Approach:
- Store the checkbox state in `src/routes/+page.svelte`.
- Pass the state into `PlayerLayer.svelte`.
- In `PlayerLayer.svelte`, draw the line only for alive players and only when the setting is enabled.
- Use the same yaw-to-canvas direction logic already used by the sight cone so alignment stays consistent.
- Color the line by current side, using the same side-switch logic as player dots.

## 4. Add Line of Sight Length Slider

Add a third slider in the same `Sight Cone Controls` section to control line-of-sight length dynamically. The minimum should be `18`; the maximum should be `800`.

Approach:
- Add a page-level line-of-sight length state in `src/routes/+page.svelte`.
- Pass that length into `PlayerLayer.svelte`.
- Keep the line length independent from the sight cone length.
- Use a conservative default so the feature is useful without covering the whole map immediately.

## 5. Clarify Round Button `+N` Text

The round buttons currently show text like `Round 1 (T +8)`. The `+8` should represent the number of T-side players alive at the end of that round. The current meaning is unclear and needs verification.

Approach:
- Inspect `RoundNav.svelte`; it currently appears to use `round.killCount`, so `+8` likely means total kills in the round, not surviving players.
- Decide whether the UI should show survivors, kills, or remove the suffix.
- If survivors are required, derive the alive count from player frames near `round.endTick`.
- Use current-round side logic, because team sides switch after halftime and overtime halves.

## 6. Color Code Round Buttons by Winner

Color-code each round button background by the round winner: CT blue and T orange. The active/selected round highlight should remain visually distinct from both winner colors.

Approach:
- Update `RoundNav.svelte` styling and button class/state logic.
- Apply winner color based on `round.winnerTeam`.
- Use a separate active state treatment, such as a bright outline, white border, or neutral highlight, instead of reusing CT/T winner colors.
- Keep text contrast readable on both blue and orange backgrounds.

## 7. Remove Previous/Next Kill Keyboard Shortcuts and Buttons

Remove the left/right keyboard shortcut behavior that currently skips through the replay. Also remove the two arrow buttons in the bottom controls section.

Approach:
- In `src/routes/+page.svelte`, remove the ArrowLeft and ArrowRight handling from `handleKeydown`.
- In `Controls.svelte`, remove the previous/next kill buttons and related props if they become unused.
- Clean up `prevKill` and `nextKill` wiring from `+page.svelte` if no other UI still uses them.
- Keep the spacebar play/pause shortcut unless a separate request asks to remove it.

## 8. Highlight Selected Player on Map

When a player is selected from the top-right player list, highlight that player's dot. The sight cone and line of sight should also use the highlight color when applicable. Green is a reasonable starting color.

Approach:
- Store the selected player Steam ID in `+page.svelte` as already planned/partially present.
- Pass the selected player Steam ID into `PlayerLayer.svelte`.
- In `PlayerLayer.svelte`, compare each rendered player against the selected Steam ID.
- Apply highlight color to the dot, sight cone, and line of sight when selected.
- Keep dead-player behavior clear: decide whether selected dead players still get a highlighted dead dot or only alive selected players are highlighted.

## 9. Add Player Selection Section and Zoom Selected Player Option

Add a `Player Selection` section beneath `Sight Cone Controls`. It should contain a checkbox labeled `Zoom Selected Player`. If checked, simulate a close-up around the selected player. Beneath the checkbox, add a slider for zoom level with a first maximum of `500%`.

Approach:
- Keep this as a visual zoom on the rendered view, not a change to map calibration or world-coordinate transforms.
- Add page-level state for whether selected-player zoom is enabled and for the zoom percentage.
- Pass selected player and zoom state to the relevant canvas layers, or introduce a shared viewport transform used consistently by map, player, nade, and kill layers.
- The safest approach is to apply a temporary canvas viewport transform centered on the selected player while preserving the underlying world-to-radar mapping.
- Define fallback behavior when no player is selected: disable zoom effect or keep normal view.
- Verify that overlays, player labels, nade trails, and kill markers still align during zoom.
