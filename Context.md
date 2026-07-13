# Context.md — CS2 Replay Viewer

Compact implementation context for future Codex work.

> **Application version:** `0.2.1`. Keep `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the application entry in `src-tauri/Cargo.lock` synchronized.

## Mandatory workflow

- Read this file before changing the project.
- Never run `pnpm tauri dev`, start a Vite dev server, or run any Svelte autofixer in this repository.
- Preserve unrelated working-tree changes. Do not stage, commit, or push unless explicitly requested.
- Parser changes do not affect the app until the Go sidecar is rebuilt. Always rebuild it after changing `backend/` behavior.

### Verification environment

The managed Windows sandbox needs workspace-local caches:

```powershell
New-Item -ItemType Directory -Force temp\go-build, temp\go-tmp, temp\tool-tmp | Out-Null
$env:GOCACHE = (Resolve-Path temp\go-build).Path
$env:GOTMPDIR = (Resolve-Path temp\go-tmp).Path
$env:TEMP = (Resolve-Path temp\tool-tmp).Path
$env:TMP = $env:TEMP
```

Run frontend tools directly rather than through pnpm:

```powershell
& .\node_modules\.bin\svelte-kit.cmd sync
& .\node_modules\.bin\svelte-check.cmd --tsconfig .\tsconfig.json
& .\node_modules\.bin\vite.cmd build
```

Go and sidecar:

```powershell
Push-Location backend
go test ./...
go build -o ..\src-tauri\binaries\cs2-parser-x86_64-pc-windows-msvc.exe .
Pop-Location
```

Rust:

```powershell
Push-Location src-tauri
cargo check
Pop-Location
```

Protobuf regeneration, only after schema changes:

```powershell
$env:PATH = "$PWD\node_modules\.bin;$env:USERPROFILE\go\bin;$env:PATH"
Push-Location proto
buf generate
Pop-Location
```

## Architecture

Data flow:

`.dem` → Go/demoinfocs parser → protobuf bytes via Rust temp file → SvelteKit frontend → layered Canvas 2D replay or Three.js 3D replay.

The 3D path is additive: `<map>.vpk` → bundled ValveResourceFormat CLI → versioned local glTF/PNG cache → bounded loopback streaming server → `ReplayScene`. The user selects the exact `steamapps\common\Counter-Strike Global Offensive` root; Rust resolves `game\csgo\maps\<replay-map>.vpk`, and the validated root is stored in the IndexedDB-backed viewer settings. Extraction is scoped to the loaded replay's map, and a completion marker prevents interrupted cache output from being reused. Large glTF buffers are exposed through bounded virtual slices instead of being loaded into a single Tauri asset response.

`pnpm tauri dev` and `pnpm tauri build` run the idempotent `ensure:extractor` step before the frontend command. It provisions the pinned ValveResourceFormat Windows CLI plus every required native DLL into `tools/source2viewer`; Tauri bundles that directory as application resources. Runtime must never ask end users to install the extractor themselves.

The active frontend is SvelteKit and starts at `src/routes/+page.svelte`. There is no standalone `App.svelte` entry point. Rendering layers are:

| Layer | Component | Purpose |
|---|---|---|
| Radar | `MapLayer.svelte` | Radar PNG/fallback and shared map fit |
| Ground items | `DroppedEquipmentLayer.svelte` | Ownerless weapon, utility, and C4 icons |
| Players | `PlayerLayer.svelte` | Trails, dots, labels, inventory, flash, bomb, noise, sight |
| Utility | `NadeLayer.svelte` | Projectile trails, effects, countdowns, hit testing |
| Kills | `KillLayer.svelte` | Death markers and clickable kill feed |
| Drawing | `DrawingLayer.svelte` | Shortcut-and-drag tactical annotations |

`ReplayCanvas.svelte`, the old monolithic renderer, `src/main.ts`, and the unused error wrapper were removed. Do not restore them.

`src/lib/playback-state.ts` is the non-reactive high-frequency render clock. Canvas layers read it in animation frames. `displayTick` in `+page.svelte` is throttled for reactive UI. Do not pass a per-frame tick prop through the component tree.

The 2D player-equipment icons use a dedicated transparent canvas inside `PlayerLayer`. Player-equipment checkbox changes must redraw only this lightweight overlay; they must not schedule the full trails, kills, bomb, noise, and sight render path.

The loaded-replay workspace uses a compact left toolbar with Sight, Player, Noise, Timeline, Equipment, and Drawing sections. Only the selected section's controls render in the adjacent slide-out panel; selecting it again or using the panel's back button closes it. Donate is a direct toolbar action and opens the same PayPal page as the Welcome screen. Drawing is a 2D-only toolbar item and must not render or open by section shortcut in 3D.

The bottom View toggle defaults to 2D. In 3D, Camera is the first toolbar section and Sight contains only line-of-sight controls plus transparency. The existing timeline, roster, round navigation, playback controls, and roster shortcuts remain shared. `src/lib/renderer/ReplayScene.ts` owns the Three.js scene and `src/lib/maps/local-map.ts` owns the Tauri map commands.

Async 3D map completion initializes the overview position only when the scene is in free-camera mode. When a player was already selected before switching from 2D, map completion reapplies the current replay scene instead of overwriting the selected player's first-person camera.

Thrown utility has an additive protobuf `trajectory_3d` stream captured from each live grenade projectile on every parsed demo frame. `ReplayScene` uses this dense, tick-timed path for 3D projectile movement and trajectory lines so arcs and collision bounces follow the replay; older replay data falls back to `trajectory`. The 2D `NadeLayer` intentionally continues to use the original `trajectory` field unchanged.

Box-shaped 3D utility projectiles (Flashbang, Decoy, Molotov, and incendiary) use their long geometry dimension on the Three.js Y axis so they render as vertical rectangles. HE and smoke projectiles remain spherical.

3D line of sight uses cylindrical mesh beams because platform WebGL implementations ignore native line widths. It is enabled by default with length 650 and 50% transparency; the 3D width range is 1–50 with step 1, and the length maximum is 1100. These 3D values are separate from the existing 2D line-of-sight values. The free-camera movement-speed default is 36. Initial W/A/S/D movement codes are written to the viewer-settings IndexedDB record on first startup and remain editable.

Living players in the 3D scene have billboarded labels above their health bars. The lower label shows the selected weapon or utility and appends `(Reloading)` while the recorded frame reports an active reload. The player-name label sits above it and follows the current side color: orange for T and blue for CT. A screen-aligned SVG row above the player name shows carried utility, carried C4, and a CT's defuse kit according to the three default-on Player-panel visibility controls. Dead-player visuals do not show these labels or inventory icons.

The 3D scene renders ownerless weapons, utilities, C4, and defuse kits as billboarded equipment SVGs at their exact recorded positions. The same Weapons, Utility, C4, and Defuse Kit visibility settings control the 2D and 3D representations, and the 3D path applies the same tick, round, and old-data carryover filtering as the 2D layer. Dropped weapon SVGs are 10% larger in 3D than the other dropped-equipment icons.

Bomb protobuf events include world X/Y/Z. The parser captures the event player's position, while `ReplayScene` uses the planter's recorded frame as a compatibility fallback for older replay data. Within the active round, the planted marker is orange, turns gray on `defused`, and red on `exploded`. The global context-menu handler suppresses the WebView menu for right-click interactions.

The 3D bomb marker has billboarded world-space status text: an orange whole-second explosion countdown after planting, a blue kit-aware defuse countdown while a living CT is actively defusing, and blue/red terminal messages after defuse/explosion. Label canvas-size changes replace the Three.js texture instead of mutating its dimensions in place, preventing the prior countdown texture from stretching when terminal text appears. Free-camera forward/backward movement follows the camera's complete view vector, including pitch, while strafing uses the camera's local right vector.

`src/lib/shortcuts.ts` owns shortcut normalization and the IndexedDB-backed `shortcut_bindings` database. The database is the source of truth for both editable assignments and fixed reservations. `ShortcutBinding.svelte` is the shared add/edit/remove UI used by panel controls, playback controls, section headers, and roster slots. An assigned keycap is itself the edit button; only the remove icon remains beside it.

## Data and replay rules

- CS2 demos are treated as 64 tick unless the parsed header provides another positive rate.
- `events.FrameDone` samples every player's position, view direction, health, armor, selected weapon, reload state, utilities, bomb possession, and defuse-kit possession. The selected weapon label adds `(Reloading)` while demoinfocs reports `Player.IsReloading`, which clears on completion or cancellation.
- Only stored T/CT participants render as players. Stored teams represent the end of the match; canvas and roster logic flips sides by half.
- CT and T roster entries are sorted independently by player name in ascending, case-insensitive, numeric-aware order. Steam ID is the deterministic tie-breaker for identical names.
- Roster shortcuts belong to the sorted side position (`CT 1`, `CT 2`, `T 1`, and so on), not to a player identity. When teams switch sides, each shortcut stays with its CT/T position and selects the new occupant.
- Round playback begins at `freezetimeEndTick`, with a 15-second fallback for old data.
- Round display ends seven seconds after the terminal event, clamped before the next round.
- The first verified knife-only round is removed and visible rounds are renumbered.
- Older protobuf data decodes new fields as empty/default. Reparse the original `.dem` to populate newer events, equipment data, and per-frame defuse-kit possession.

### Coordinates and maps

- Radar assets: `static/maps`; overview metadata: `src/lib/maps/radar-info.ts`.
- Shared conversion: `worldToCanvas()` in `src/lib/canvas/transforms.ts`.
- Formula: `radarX = (worldX - posX) / scale`, `radarY = (posY - worldY) / scale`.
- `MAP_CANVAS_MARGIN` must be shared by radar and overlay transforms.
- Nuke, Train, and Vertigo have lower-map background variants; overlays keep the same transform.
- `MapLayer` shows a lightweight radar-loading surface instead of the fallback grid during normal image loading. It reports readiness only after the radar has painted for one frame; replay overlays remain unmounted until then. Image failure paints the fallback background before releasing the gate.

### Dropped equipment and drop noise

- Weapon, utility, and C4 ground-item records must come only from exact ownerless equipment entities. Defuse kits are the sole exception because demoinfocs exposes them only through the player's `m_pItemServices.m_bHasDefuser` property and never as entries in `GameState().Weapons()`. Their lifecycle starts from the last recorded carrier state at the kill event (with the completed-frame transition as a fallback), and ends when a living CT gains the property or the round closes.
- Each record is a position segment with start/end ticks and category `weapon`, `utility`, `c4`, or `defuse_kit`.
- A defuse-kit segment starts at the recorded player position when a kit carrier transitions to dead without the kit. It remains active until the nearest living player transitions from no kit to having one, or until the round closes. This dedicated lifecycle is required; adding `EqDefuseKit` to `droppedEquipmentCategory()` cannot work because no equipment entity exists there.
- The frontend additionally scopes records to the round in which their segment started. Selecting a new round must clear every prior-round ground item, even for older overlong sidecar data.
- At parser round end/boundary, snapshot every currently ownerless equipment entity, close active segments, and suppress those entity IDs until they disappear or become owned. The frontend propagates carryover detection through continuous movement segments for older data. Final exact positions may remain through the finished round's seven-second tail.
- Raw `item_remove` events provide category data when demoinfocs returns `ItemDrop.Weapon == nil`.
- New ownerless entities are matched to queued drop events by category, tick, and proximity. If no usable event exists, associate the entity with the nearest T/CT player within 512 world units.
- `BombDropped` queues C4 ownership for entity matching; it does not emit noise at throw time.
- A dropped entity must remain within 0.5 world units for six ticks before `weapon_drop`, `utility_drop`, or `c4_drop` noise is emitted at its settled destination. Dropped defuse kits are visual-only and do not emit a noise event.

### Noise rendering

- Types: `running`, `jump`, `shooting`, `falling`, `weapon_drop`, `utility_drop`, `c4_drop`, `weapon_reload`.
- Empty/`sound`/`footstep` values normalize to `running`; unknown types stay hidden.
- `Show Noise Circle` is the master toggle; source filters default on; selected-player mode filters by Steam ID.
- Noise has a dedicated transparent canvas below players. Checkbox changes redraw only this layer.
- Noise events are sorted once. Rendering binary-searches to the earliest event whose lifetime can overlap the current tick.
- Running follows the current player position with a short hold/fade. Shooting/reload follow the current player. Jump, fall, and drops remain at event origin.

### Utility and effects

- Smoke lasts 1152 ticks, fire at most 448 ticks, Decoy 960 ticks; HE/Flash effects are brief.
- Inferno expiry events are authoritative because smoke can extinguish fire early.
- Projectile destruction for Molotov/incendiary ends the projectile and must not start a second fire lifetime.
- Nade trajectories are distance-retimed when raw timing is unreliable and reveal progressively.
- Smoke/fire effects show icons and whole-second countdowns. Flash/HE/Decoy endpoints remain interactive briefly.
- The 3D smoke effect radius is scaled to 90% of the recorded/default radius. The 2D smoke radius remains unchanged.

### Selection and interaction

- Selecting a living player centers and follows them; selecting again or dragging empty space clears selection while retaining the viewport.
- Selection clears when the player dies. Dead icons support copy on single click and lead-in seek on double-click.
- Map wheel zoom targets the pointer without selection; with selection it changes follow zoom.
- Hold the editable keyboard-only Drawing Setup shortcut and drag either mouse button to draw. Shift is the default; releasing the shortcut finalizes the stroke.
- Timeline event single-click seeks with a lead-in; double-click copies `demo_goto`.

### Toolbar and shortcuts

- Toolbar items use centered icons and labels. Hover and the open section share the highlight treatment, while keyboard focus uses a separate outline. Closing or switching panels by shortcut releases stale mouse focus so only the open section remains highlighted.
- A toolbar item displays its assigned section shortcut as readable supporting text in brackets, such as `[SHIFT+D]`, below the label.
- Every panel header, checkbox, button, and roster player supports one editable shortcut. Sliders support separate decrease and increase shortcuts placed on the corresponding sides of the slider. Color pickers intentionally have no shortcut UI.
- The bottom Play/Pause, load-demo, and map-variant controls use the shortcut editor. Replay-speed preset buttons intentionally do not support shortcuts. Space is seeded as the editable Play/Pause shortcut.
- Shortcut capture accepts keyboard, mouse-button, and wheel input. Control, right Control, Shift, Alt, Alt Gr, and Caps Lock are modifier-only; other held keys can also combine with mouse input.
- Escape always cancels shortcut capture without modifying or removing the existing assignment.
- Assignments are globally unique. A duplicate remains in capture mode and reports the control already using it through the shared toast.
- Shortcuts execute while their panel is closed. Checkboxes toggle, buttons run their click behavior, sliders change by their declared step and stay within their range, section shortcuts toggle panels, and roster-slot shortcuts invoke the existing player selection behavior for the slot's current occupant.
- Holding a keyboard shortcut repeats only slider decrease/increase actions at the operating system's key-repeat rate. Every non-slider action remains limited to one trigger per key press.
- Shortcut keycaps subscribe to the shared binding store so database-confirmed add, edit, and remove operations update every visible shortcut immediately.
- Clicking an assigned shortcut keycap starts editing it; there is no separate pencil icon.
- Empty decrease bindings use a minus icon on the left side of sliders; increase bindings use a plus icon on the right.
- Drawing Setup has its own editable keyboard-only hold shortcut, seeded to Shift. Existing mouse-based Drawing Setup assignments are migrated back to Shift. Drawing colors are labeled Primary Color and Secondary Color.
- Fixed IndexedDB reservations protect mouse-wheel map zoom from reassignment.

### Application branding

- `static/app-icon.png` is the browser favicon source.
- Tauri bundle icons in `src-tauri/icons` are generated from the same two-cherry application logo.

## Release documentation

`README.md` describes user-visible features. Update it only when behavior/features change.

`RELEASE_NOTES.md` is GitHub-ready and written for non-technical users. Start with a summary and Change Overview, then use applicable sections:

- 🚀 New Features
- 🔧 Adjusted Features
- 🗑️ Removed Controls/Features
- ⚡ Performance Improvements
- 🐛 Bug Fixes
- 📦 Version and Documentation

Describe visible outcomes, not source files, internal types, parser implementation, caches, builds, or tests.

## Key dependencies and sources

- Demo parser: `github.com/markus-wa/demoinfocs-golang/v5`
- Serialization: Protocol Buffers / `@bufbuild/protobuf`
- Desktop shell: Tauri v2
- UI: Svelte 5 / SvelteKit / Vite
- Radar assets: MurkyYT `cs2-map-icons`
- Equipment SVGs: Juknum `counter-strike-icons`, stored under `static/equipment-icons`
