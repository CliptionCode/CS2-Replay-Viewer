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

## 10. Copy Tick Command When Double-Clicking Markers

When double-clicking a marker, such as a kill, death, HE grenade, smoke, flash, molotov, or similar event marker, copy a CS2 demo tick command to the user's clipboard. The copied tick should be the event tick minus 2 seconds so the user can see the lead-up to the event. Copy the full command in this format: `demo_goto <Tick Number>`, for example `demo_goto 72401`.

Approach:
- Add double-click handling to marker elements or the marker layer.
- Derive the target tick from the event tick minus 2 seconds, using the demo tick rate to convert seconds to ticks.
- Clamp the target tick so it never goes below the beginning of the demo or current round.
- Use the Clipboard API to copy the full `demo_goto` command.
- Show a short toast or equivalent feedback for 2-3 seconds confirming that the tick command was copied.
- Keep the feedback non-blocking and avoid interfering with marker selection or playback controls.

## 11. Show Flash Opacity Circle Around Flashed Players

Draw a grey filled circle around the player dot while the player is flashed. The circle opacity should reflect flash strength: fully flashed players should have an opaque grey circle, partially flashed players should have a more transparent circle, and lightly flashed players should have a very transparent circle. The circle should continuously fade until the player can see again.

Approach:
- Determine whether flash duration or flash alpha data is available in the parsed demo state.
- Pass the current flash strength or remaining flash duration into `PlayerLayer.svelte`.
- Draw the flash circle around the affected player without hiding the player dot or label.
- Map flash strength to grey circle opacity, with full flash using maximum opacity and partial flashes using proportional opacity.
- Decrease opacity continuously as the flash wears off.
- Remove the circle once the player is no longer flashed.

## 12. Show Noise Radius Circles Around Alive Players

Draw a noise circle around each alive player who makes noise, such as jumping, shooting a weapon, or running to a location. The circle should use the correct noise radius, have a red border, and keep the inner area transparent so the player dot remains fully visible. Remove the noise circle after the noise duration ends.

Approach:
- Identify or derive sound events for alive players, including jump, shot, and running noise events.
- Store active noise events with player identity, origin, radius, start tick, and end tick or duration.
- Render the noise circle using the event radius converted through the existing radar coordinate transform.
- Style the circle with a red stroke and transparent fill.
- Remove expired noise circles as playback advances.
- Ensure multiple overlapping noise events do not permanently obscure the map or player dots.

## 13. Make Kill Feed Items Clickable

Make each kill feed item clickable. Clicking a kill feed item should select the killing player and skip playback to 2 seconds before the kill event happened.

Approach:
- Add click handling to kill feed items.
- Store or pass each kill event's killer Steam ID and event tick into the kill feed component.
- On click, update the selected player to the killer.
- Seek to the kill tick minus 2 seconds, converting seconds to ticks using the demo tick rate.
- Clamp the target tick to the valid playback range.
- Keep keyboard and timeline behavior consistent after the seek.

## 14. Show Alive and Total Player Counts Per Team Section

Add the amount of living players and total players to each team section header. Example labels: `CT (3/5)` and `T (1/5)`.

Approach:
- Derive team totals from the current round/player roster.
- Derive alive counts from the current playback tick.
- Update the CT and T section header rendering to include `alive/total`.
- Use current-round side assignments so counts remain correct after side switches.
- Confirm disconnected, dead, spectator, or unassigned players are not counted incorrectly.

## 15. Show Bomb Planted and Defuse Status Labels

If the bomb has been planted, show a centered orange label beneath the timeline with the text `Bomb Planted XXs`, where `XXs` is the number of seconds until the bomb would detonate. Update the countdown continuously. When the bomb explodes, show `Bomb exploded, Terrorists Win!`.

If the bomb is currently being defused, show a centered blue label beneath the bomb-planted label with the text `Defusing XXs`, where `XXs` is the number of seconds until the bomb would be defused. Hide the defuse text if the defuser is killed or cancels the defuse. If the bomb is successfully defused, show `Bomb has been defused. Counter Terrorists Win`.

Approach:
- Track bomb planted, exploded, defusing, cancelled, and defused states from demo events.
- Compute countdown values from current tick, plant tick, explosion tick, defuse start tick, and defuse completion tick.
- Add centered status labels beneath the timeline.
- Color the bomb planted/exploded state orange.
- Color the defusing/defused state blue.
- Hide labels when the state no longer applies, except for final exploded or defused result text where appropriate.
- Verify the labels do not overlap playback controls or timeline markers on narrow screens.

## 16. Add Bomb Explosion and Bomb Defused Timeline Markers

If the round win reason is bomb explosion, add a timeline marker labeled `BE` for Bomb Explosion and color it orange. If the bomb is defused, add a timeline marker labeled `BD` for Bomb Defused and color it blue.

Approach:
- Check whether bomb explosion and bomb defused markers already exist.
- If missing, create marker events from round win reason or bomb lifecycle events.
- Label bomb explosion markers as `BE` and bomb defused markers as `BD`.
- Use orange for `BE` and blue for `BD`.
- Place the marker at the exact explosion or defuse tick.
- Avoid duplicate markers if the parser already emits equivalent bomb events.
