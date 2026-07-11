# Context.md — CS2 Replay Viewer

Compact implementation context for future Codex work.

> **Application version:** `0.1.11`. Keep `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the application entry in `src-tauri/Cargo.lock` synchronized.

## Mandatory workflow

- Read this file before changing the project.
- For any `.svelte` or Svelte module work, first load both `svelte-core-bestpractices` and `svelte-code-writer`.
- For Rust work, load `rust-best-practices` when that skill is available.
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

`.dem` → Go/demoinfocs parser → protobuf bytes via Rust temp file → SvelteKit frontend → layered Canvas 2D replay.

The active frontend is SvelteKit and starts at `src/routes/+page.svelte`. There is no standalone `App.svelte` entry point. Rendering layers are:

| Layer | Component | Purpose |
|---|---|---|
| Radar | `MapLayer.svelte` | Radar PNG/fallback and shared map fit |
| Ground items | `DroppedEquipmentLayer.svelte` | Ownerless weapon, utility, and C4 icons |
| Players | `PlayerLayer.svelte` | Trails, dots, labels, inventory, flash, bomb, noise, sight |
| Utility | `NadeLayer.svelte` | Projectile trails, effects, countdowns, hit testing |
| Kills | `KillLayer.svelte` | Death markers and clickable kill feed |
| Drawing | `DrawingLayer.svelte` | Shift-drag tactical annotations |

`ReplayCanvas.svelte`, the old monolithic renderer, `src/main.ts`, and the unused error wrapper were removed. Do not restore them.

`src/lib/playback-state.ts` is the non-reactive high-frequency render clock. Canvas layers read it in animation frames. `displayTick` in `+page.svelte` is throttled for reactive UI. Do not pass a per-frame tick prop through the component tree.

## Data and replay rules

- CS2 demos are treated as 64 tick unless the parsed header provides another positive rate.
- `events.FrameDone` samples every player's position, view direction, health, armor, selected weapon, reload state, utilities, and bomb possession. The selected weapon label adds `(Reloading)` while demoinfocs reports `Player.IsReloading`, which clears on completion or cancellation.
- Only stored T/CT participants render as players. Stored teams represent the end of the match; canvas and roster logic flips sides by half.
- Round playback begins at `freezetimeEndTick`, with a 15-second fallback for old data.
- Round display ends seven seconds after the terminal event, clamped before the next round.
- The first verified knife-only round is removed and visible rounds are renumbered.
- Older protobuf data decodes new fields as empty/default. Reparse the original `.dem` to populate newer events and equipment data.

### Coordinates and maps

- Radar assets: `static/maps`; overview metadata: `src/lib/maps/radar-info.ts`.
- Shared conversion: `worldToCanvas()` in `src/lib/canvas/transforms.ts`.
- Formula: `radarX = (worldX - posX) / scale`, `radarY = (posY - worldY) / scale`.
- `MAP_CANVAS_MARGIN` must be shared by radar and overlay transforms.
- Nuke, Train, and Vertigo have lower-map background variants; overlays keep the same transform.
- `MapLayer` shows a lightweight radar-loading surface instead of the fallback grid during normal image loading. It reports readiness only after the radar has painted for one frame; replay overlays remain unmounted until then. Image failure paints the fallback background before releasing the gate.

### Dropped equipment and drop noise

- Parser ground-item records must come only from exact ownerless equipment entities—never synthetic player/death positions.
- Each record is a position segment with start/end ticks and category `weapon`, `utility`, or `c4`.
- The frontend additionally scopes records to the round in which their segment started. Selecting a new round must clear every prior-round ground item, even for older overlong sidecar data.
- At parser round end/boundary, snapshot every currently ownerless equipment entity, close active segments, and suppress those entity IDs until they disappear or become owned. The frontend propagates carryover detection through continuous movement segments for older data. Final exact positions may remain through the finished round's seven-second tail.
- Raw `item_remove` events provide category data when demoinfocs returns `ItemDrop.Weapon == nil`.
- New ownerless entities are matched to queued drop events by category, tick, and proximity. If no usable event exists, associate the entity with the nearest T/CT player within 512 world units.
- `BombDropped` queues C4 ownership for entity matching; it does not emit noise at throw time.
- A dropped entity must remain within 0.5 world units for six ticks before `weapon_drop`, `utility_drop`, or `c4_drop` noise is emitted at its settled destination.

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

### Selection and interaction

- Selecting a living player centers and follows them; selecting again or dragging empty space clears selection while retaining the viewport.
- Selection clears when the player dies. Dead icons support copy on single click and lead-in seek on double-click.
- Map wheel zoom targets the pointer without selection; with selection it changes follow zoom.
- Hold Shift and drag either mouse button to draw. Releasing Shift finalizes the stroke.
- Timeline event single-click seeks with a lead-in; double-click copies `demo_goto`.

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
