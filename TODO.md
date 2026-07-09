# TODO

## Implemented Change Requests

### 1. Noise Controls

- Status: implemented.
- Added a `Noise` section below `Player Selection`.
- Added `Show Noice Circle`, unchecked by default.
- Added `Noise for Selected Player`, unchecked by default and dependent on `Show Noice Circle`.
- Added source filters, checked by default:
  - `Running Noise`
  - `Jump Noise`
  - `Shooting Noise`
  - `Falling Noise`
- Parser now tags noise from footsteps/player sound as `running`, jump events as `jump`, weapon fire as `shooting`, and fall damage as `falling`.
- Older parsed noise events with empty, `sound`, or `footstep` type are treated as `running`.
- Unknown noise types are ignored instead of being exposed as `Other Noise`.

### 2. Running Noise Circle Behavior

- Status: implemented.
- Running noise uses one active circle per running player.
- The circle follows the player position instead of staying at the original sound origin.
- The circle holds briefly while running continues and fades quickly after running stops.
- Non-running noise sources still use event-origin circles and fade by event lifetime.

### 3. Knife Round Auto-Skip

- Status: strengthened for newly parsed demos.
- The Go parser samples alive T/CT inventories throughout the first parsed round instead of relying only on `round_start`.
- The first round is marked knife-only only when enough player inventories show knives and no non-knife evidence appears.
- Non-knife inventory, non-knife kills/damage, weapon fire, nade activity, or bomb events prevent knife-round skipping.
- The first knife-only round is removed from serialized `ReplayData.rounds`.
- Visible round numbers are renumbered after the skipped knife round.

### 4. Initial Round Selection

- Status: implemented.
- Loading a replay now seeks to the active start of the first visible round.
- This happens after parser-side knife-round removal, so visible `Round 1` is selected.

### 5. Sight Cone Visibility Controls

- Status: implemented.
- Added `Show Sight Cone`, checked by default.
- Added `Show for selected Player`, unchecked by default.
- Sight cone controls are independent from `Show Line of Sight`.
- Width/length controls are disabled when sight cones are hidden.

### 6. Planted Bomb Dot

- Status: implemented.
- Player layer draws a static red `Bomb` dot after a successful plant.
- Position uses the bomb planter's frame at the plant tick.
- The bomb dot does not move and does not emit noise.

### 7. Round List Survivor Counts

- Status: implemented.
- Round buttons now show survivor counts for both teams:
  - `Round 5 (T + 2 | CT + 1)`
  - `Round 5 (T + 2)`
  - `Round 5 (CT + 1)`
  - `Round 5 (No Survivors)`
- Winner is still communicated by the existing round-button color.

### 8. Default Line of Sight Length

- Status: implemented.
- `Line of Sight Len` default is now `300`.

### 9. Seven-Second Round-End Display Window

- Status: implemented in parser and frontend compatibility layer.
- Parser extends stored round end by 7 seconds for all round conclusions.
- Frontend helper `src/lib/replay/rounds.ts` computes display end ticks for old or newly parsed data.
- The 7-second tail applies to bomb detonation, defuse, timeout/target saved, and elimination rounds.
- Playback, timeline progress, kill feed filtering, player trails, round context, and survivor counts use the display end tick.

### 10. Normal/Lower Map Toggle

- Status: implemented.
- Bottom controls show `Normal` and `Lower` map toggles only when the loaded map has a lower radar variant.
- Supported lower variants are currently `de_nuke`, `de_train`, and `de_vertigo`.
- `Normal` is selected by default.
- `Lower` swaps the map background image to the lower radar PNG while keeping the same coordinate transform.

### 11. Kill Feed / Left Controls Overlap

- Status: implemented.
- Kill feed text and click hitboxes are offset to the right of the left controls panel.
- This keeps kill feed rows visible and clickable after the controls panel gained extra sections.

### 12. Load Demo Button

- Status: implemented.
- Added a `Load Demo` button at the bottom-left of the controls toolbar.
- The button opens the existing `.dem` picker.
- Cancelling the picker keeps the current replay loaded.
- Selecting a new demo stops playback, clears current replay data and frontend caches, lets old replay layers unmount, then loads the new parsed protobuf.

### 13. Shooting Noise Rendering

- Status: implemented.
- Shooting noise is still parsed from weapon-fire events as `shooting`.
- `PlayerLayer.svelte` now draws shooting noise around the shooter's current position during the event lifetime.
- The ambiguous `Other Noise` UI option was removed because the parser only exposes concrete distinguishable sources.

## Validation Notes

- `go test ./...` passed after allowing Go to write its build cache.
- `.\node_modules\.bin\vite.CMD build` passed.
- Rebuilt the Go sidecar binary at `src-tauri/binaries/cs2-parser-x86_64-pc-windows-msvc.exe` so newly parsed demos use the updated parser.
- `svelte-check` still reports pre-existing project issues unrelated to these changes, including missing Node type declarations and legacy `ReplayCanvas`/`renderer.ts` type errors.
- Do not run `pnpm tauri dev`.
- Do not start or host Vite automatically; the user wants to verify manually.
- Do not run the Svelte autofixer.
