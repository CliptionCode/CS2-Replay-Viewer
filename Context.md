# Context.md — CS2 Replay Viewer

> Supplementary information for an AI implementing this project. Contains background knowledge, gotchas, library deep-dives, and reference material not covered in the implementation plan.

> **Application version:** `0.1.8`. This version refines grenade destination markers, team-colors dead-player icons, adds death-specific three-second click behavior and automatic deselection, supports exact parser-backed dropped-equipment rendering through the post-round window, and expands map panning at every zoom level. Keep `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the application package entry in `src-tauri/Cargo.lock` on the same version when releasing later changes.

> **IMPORTANT:** Whenever writing or modifying **Svelte** code, always load the `svelte-core-bestpractices` and `svelte-code-writer` skills first. Whenever writing or modifying **Rust** code, always load the `rust-best-practices` skill first.
>
> **Project workflow constraints:** Do not run `pnpm tauri dev`. Do not start or host a Vite dev server automatically; the user wants to run and verify manually. Never run `npx @sveltejs/mcp svelte-autofixer` or any other Svelte autofixer command in this repository.

> **Release notes structure and audience:** Release notes are written for **non-technical end users**. Write them as GitHub-ready Markdown with changes grouped by type so additions, adjustments, removals, performance work, and fixes are immediately distinguishable. Start with a short release summary and a **Change Overview** legend, then use these top-level sections when applicable: 🚀 **New Features**, 🔧 **Adjusted Features**, 🗑️ **Removed Controls/Features**, ⚡ **Performance Improvements**, 🐛 **Bug Fixes**, and 📦 **Version and Documentation**. Use descriptive subsections and concise bullets that explain only what users can see, do, or experience differently. Do not mention source files, programming languages, frameworks, schemas, event or function names, internal data structures, generated files, parser/sidecar internals, caching/indexing strategies, build steps, or test implementation. Translate performance and reliability work into its visible benefit, such as smoother selection or corrected timing. Keep exact values such as dimensions, durations, defaults, and keyboard controls only where they help users understand the product behavior. Do not mix removed or adjusted behavior into the new-feature section.

---

## 1. CS2 Demo File Format (.dem)

### 1.1 What a .dem file contains

A CS2 replay file is a **binary stream** recorded by Valve's Source 2 engine at the server level. It contains:

- **Header** — Map name, tick rate (always 64), protocol version, server name, playback time
- **Network messages** — Entity updates, packet entities, sound data, etc.
- **Game events** — Structured events like `player_death`, `round_start`, `weapon_fire`, `grenade_throw`, etc.
- **User messages** — Chat text, radar info, hints
- **Console variables** — Server ConVars at time of recording
- **String tables** — Player names, model names, sound names, etc.

The `demoinfocs-golang` library handles **all** of the parsing. Your code never touches the raw `.dem` format directly.

### 1.2 64-Tick Hard Limit

CS2 **replays** are always recorded at 64 ticks/sec, regardless of the server's tick rate (which can be 64 or 128 on community servers). This is a Valve design decision — the demo format is decoupled from the server tick rate.

**Implication:** All timing calculations use 64 ticks/sec. A 40-minute match = 40 × 60 × 64 = 153,600 ticks.

### 1.3 Demo Format Version

CS2 uses `.dem` format version 4 (Source 2). CS:GO used format versions 2-3 (Source 1). The `demoinfocs-golang` v5 library handles both. Your app only targets CS2 (v4+), but the library will error gracefully if given an incompatible version.

### 1.4 Compressed vs Uncompressed Demos

CS2 demos from official matchmaking are compressed. The library handles decompression transparently. Demos from Faceit/ESEA may be compressed differently or not at all — the library handles all common formats.

---

## 2. Coordinate Systems Deep Dive

### 2.1 CS2 World Coordinates

Counter-Strike 2 uses a right-handed Z-up coordinate system:

- **X axis**: East-West (positive = East toward T spawn on most defuse maps)
- **Y axis**: North-South (positive = North)
- **Z axis**: Height (positive = up, in Hammer units)

World coordinates for common maps:

| Map | Min X | Max X | Min Y | Max Y | Notable |
|---|---|---|---|---|---|
| de_dust2 | -2500 | 2500 | -2500 | 2500 | Centered origin |
| de_mirage | -2500 | 2500 | -2500 | 2500 | Centered origin |
| de_inferno | -2500 | 2500 | -2500 | 2500 | Slightly offset |
| de_nuke | -3000 | 3000 | -3000 | 3000 | Multi-tier (Z matters!) |
| de_overpass | -2500 | 2500 | -2500 | 2500 | Centered |
| de_ancient | -2500 | 2500 | -2500 | 2500 | Centered |
| de_anubis | -2500 | 2500 | -2500 | 2500 | Centered |
| de_vertigo | -2500 | 2500 | -2500 | 2500 | Multi-tier |
| de_cache | -2500 | 2500 | -2500 | 2500 | Centered |

These are approximate. Always use the **overview.txt coordinate files** for exact bounds.

### 2.2 The Overview Coordinate Transform

Every official CS2 map ships with an `overview.txt` file embedded in the VPK containing pos_x, pos_y, scale, rotate, and zoom values. The transform converts world coordinates to radar pixel coordinates: radarX = (worldX - posX) / scale, radarY = (posY - worldY) / scale (Y axis inverted). The `scale` factor is Hammer units per radar pixel. For de_dust2 at 4.4, a 1024×1024 radar covers about 1024 × 4.4 = 4505 Hammer units across. The `rotate` value is retained as source metadata but is not applied as a coordinate angle by the viewer.

### 2.3 Why Y is Inverted

CS2 uses Y-up for north, but screen coordinates use Y-down for north. The formula `radarY = (posY - worldY) * scale` flips the axis. This is consistent across all Valve maps.

### 2.4 Player View Direction

**Yaw** (horizontal rotation):
- 0° = looking toward positive Y (North in game)
- 90° = looking toward positive X (East)
- 180° = looking toward negative Y (South)
- 270° = looking toward negative X (West)

**Pitch** (vertical rotation):
- 0° = looking level
- Positive = looking down (90° = straight down)
- Negative = looking up (-90° = straight up)

For the 2D radar view, **yaw** is used to show the direction the player is facing. The viewer draws a white radar-style sight cone from the player dot. CS/Source yaw is treated as 0° toward positive X and 90° toward positive Y, then passed through `worldToCanvas()` so the radar's inverted Y axis is handled consistently.

### 2.5 Nuke / Vertigo Multi-Tier Problem

de_nuke and de_vertigo have multiple vertical levels. The Z coordinate distinguishes them. For the 2D radar, **both levels share the same X,Y space**.

**Options for handling:**
1. Show ALL players on one map (simplest — both levels overlapping)
2. Filter by Z: only show players on the same level (requires knowing round phase)
3. Use semi-transparent dots for players on other levels

**Recommendation for v1:** Show all players; optionally add a Z-indicator (small number near the dot showing floor level).

A simple heuristic for level detection:
- de_nuke: Z > -200 = above ground (A site, ramp), Z ≤ -200 = below ground (B site, vents)
- de_vertigo: Z > 0 = upper level, Z ≤ 0 = lower level

---

## 3. demoinfocs-golang v5 API Deep Dive

### 3.1 Package Organization

The library is at `github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs`. Key sub-packages: `events/` (game events like Kill, RoundStart, WeaponFire, etc.), `common/` (Player, Team, Equipment, Position, GrenadeProjectile, Round, GameState), `sendtables/` (low-level entity access), and `msg/` (protobuf message types).

### 3.2 Parser Lifecycle

1. Create parser via `NewParser(reader)` → `Parser`
2. Register event handlers via `p.RegisterEventHandler(func(e events.X))`
3. Call `p.Parse()` — blocks until EOF or error
4. Call `p.Close()` — clean up

**Important:** All event handlers run in the context of `p.Parse()`. They execute synchronously as the parser processes each tick. Do **not** do heavy computation in event handlers — just store the data.

### 3.3 Getting Player Positions (Confirmed Working)

This is the trickiest part of the API. There is **no single callback** for "every tick, give me all player positions." The confirmed approach uses `events.FrameDone` (available in v5 of the library) to sample all player positions at every game frame. Inside the handler, you get the current tick via `p.CurrentFrame()`, iterate `p.GameState().Participants().All()`, and for each non-nil player extract position, view direction, health, armor, weapon, and alive state into a `PlayerFrame` struct.

`events.FrameDone` fires on every tick boundary. It deduplicates by checking `tick != r.lastTick`. `Participants().All()` returns all players (alive + dead + spectators), unlike `Participants().Playing()` which only returns alive players. Use `All()` for complete frame coverage including dead players whose dots should still render on the map.

### 3.4 Getting Grenade Trajectories

`p.GameState().GrenadeProjectiles()` returns active projectile objects. Each has a `WeaponInstance` identifying the nade type, a `Position()` for current position, `DetonationTime` for when it will detonate, and a `Trajectory` slice of `TrajectoryPoint` structs each containing a `Position` and `Tick`.

**Critical:** `GrenadeProjectile` objects are **only available while the projectile is active** (in flight or smoke deployed). Once a smoke dissipates or a HE explodes, the object is removed from `GrenadeProjectiles()`. Capture trajectory in the `GrenadeProjectileDestroyed` or `SmokeExpired` event.

### 3.5 Event Timing

Each event struct contains timing information, but the exact field varies. The Kill event contains the tick, killer, victim, weapon, headshot flag, and penetrated objects count. Round events contain the tick (round number is obtained from `p.GameState().Rounds()`).

**Always check the actual struct fields in the events package.** The v5 API may differ from the examples in the README.

### 3.6 The `ParseFile` Convenience Function

For production use, prefer manual `NewParser` + `Parse` + `Close` for better error handling.

---

## 4. CS2 Game Mechanics for the Reporter

### 4.1 Round Structure

A standard CS2 round consists of:

1. **Freezetime** (~20 seconds): Players are locked in spawn, can buy equipment
2. **Active phase** (~1:55 on bomb timer): Players move, fight, plant/defuse
3. **Round end** (on elimination, bomb detonation/defuse, or time)

Official match format: MR12 (first to 13 rounds). Max rounds: 24 (12 each).
Overtime: MR3 (first to 4 rounds), repeated as needed.

**Event sequence for a normal round:** RoundStart (buy time begins), RoundFreezetimeEnd (freezetime ends = round actually begins), then kills/nades/damage events, then RoundEnd with a conclusion reason.

The `RoundFreezetimeEnd` event is captured by the Go parser and stored as `RoundData.FreezetimeEndTick`. The viewer auto-skips to this tick when seeking to a round or pressing play during freezetime.

Round display continues for a 7-second post-round window. New parser output stores `RoundData.EndTick` as the round-end event tick plus 7 seconds for every conclusion type, including elimination, bomb detonation, defuse, and timeout. The frontend also has a compatibility helper in `src/lib/replay/rounds.ts` that computes an effective display end for older parsed data and clamps it before the next round start.

### 4.2 Win Reasons (RoundConclusionReason)

| Constant | Meaning |
|---|---|
| `CTWin` | CTs eliminated Ts |
| `TerroristWin` | Ts eliminated CTs |
| `BombDetonated` | T bomb exploded |
| `BombDefused` | CT defused bomb |
| `TimeRanOut` | Time expired, CT win |
| `TargetSaved` | Time expired in hostage mode |
| `TerroristsEliminated` | All Ts eliminated |
| `CTsEliminated` | All CTs eliminated |

### 4.3 Equipment Names

The library returns weapon names from `Equipment.String()`. Known values:

**Rifles:** AK-47, M4A4, M4A1-S, SG 553, AUG, Galil AR, FAMAS
**Sniper:** AWP, SSG 08 (Scout), G3SG1, SCAR-20
**SMG:** MAC-10, MP9, MP7, MP5-SD, UMP-45, P90, PP-Bizon
**Heavy:** Nova, XM1014, MAG-7, M249, Negev
**Pistols:** USP-S, P2000, Glock-18, P250, Five-SeveN, Tec-9, CZ75-Auto, Desert Eagle, Dual Berettas, R8 Revolver
**Equipment:** Zeus x27, Flashbang, HE Grenade, Smoke Grenade, Molotov, Incendiary, Decoy, Defuse Kit

**Weapon names in kill events:** The weapon field will match these exact strings from `Equipment.String()`. No need for additional mapping.

### 4.7 KAST Calculation (Implemented)

KAST = the percentage of rounds where a player contributes via **K**ill, **A**ssist, **S**urvive, or **T**rade.

Implemented in `backend/parser/parser.go`:

- **Kill**: Tracked per-round via `events.Kill` → `roundStats.kills[steamID] = true`
- **Assist**: Tracked via `e.Assister` field on `events.Kill` → `roundStats.assists[steamID] = true`
- **Survive**: A player survived a round if they have no death recorded for that round → `!roundStats.deaths[steamID]`
- **Trade**: Tracked via a `recentKills` ring buffer (512 ticks). When player A kills player B, and then player C (same team as B) kills A within 256 ticks, C gets a trade → `roundStats.trades[steamID] = true`

At `recordRoundEnd`, each player who was present in the round is marked as contributing if any of the four flags is true. KAST% = `(contributingRounds / totalRounds) * 100`, computed in `buildReplayData`.

Trade detection window: 256 ticks (~4 seconds at 64 tick). Recent kills ring buffer prunes entries older than 512 ticks.

### 4.4 Nade Timing Constants

Approximate durations (at 64 tick/sec = 1 tick = 15.625ms):

| Nade | Flight time (max) | Effect duration | Duration in ticks | Notes |
|---|---|---|---|---|
| Smoke | ~2-3 seconds | 18 seconds | 1152 | Each deployed smoke has its own full 18-second lifecycle |
| HE Grenade | ~2-3 seconds | Instant | 5 | Blast radius ~250 units |
| Flashbang | ~2-3 seconds | ~2-3 seconds flash effect | 3 | Affects based on facing/range |
| Molotov/Incendiary | ~1-2 seconds | ~7 seconds | 448 | Spreads on impact |
| Decoy | ~2-3 seconds | ~15 seconds | 960 | Mimics gunfire sounds |

**Used in:** `recordSmokeStart`, `recordInfernoStart`, `recordFlashExplode`, `recordHeExplode`, and `recordNadeDestroyed` (backend `parser.go`). Effect lifecycle records add the durations above to `DetonationTick`. Destroyed Molotov/incendiary projectile records are trajectory-only and receive `FadeTick = destroyTick`; only the matching inferno lifecycle may render their ground fire.

Every `SmokeStart` record owns an immutable 18-second lifetime (`DetonationTick + 1152`). `SmokeExpired` events do not mutate smoke fade ticks, so one smoke expiring can never shorten another smoke deployed by the same player. `NadeLayer.svelte` independently enforces the same canonical fade calculation, which also repairs countdowns from older parser output containing an incorrect early `FadeTick`. Smoke trajectory matching scores candidates against the expected 18-second start-to-destruction offset instead of preferring whichever smoke event happens to have the nearest raw tick.

Your nade effect rendering: **Binary** — circles visible for active smokes, HEs, flashes, and fire nades (between detonation tick and fade tick). Decoys are the exception: they render only a brown endpoint dot with a `Decoy` label while active. Expansion/fade ignored for v1.

### 4.8 Nade Flight Trails (Implemented)

Nade trajectories are drawn progressively in `NadeLayer.svelte`. The full trajectory is not revealed immediately. The renderer uses stored `NadeTrajectoryPoint` positions for path shape, but does not blindly trust their raw ticks because those samples can include stale or stationary spans. It retimes the compacted path by distance so the projectile reaches the endpoint exactly at the canonical pop/explosion tick.

- `FALLBACK_FLIGHT_DURATION_TICKS = 96` is used only when a nade has start/end positions but no sampled trajectory ticks.
- Raw trajectory timing is trusted if the flight span is between `MIN_FLIGHT_DURATION_TICKS = 24` and the per-type maximum. Most nades use `MAX_TRUSTED_RAW_FLIGHT_TICKS = 256`; smoke uses `MAX_TRUSTED_SMOKE_RAW_FLIGHT_TICKS = 640` so long smoke lineups can start at their actual throw tick instead of being compressed into the short fallback window.
- `TRAJECTORY_VISIBLE_TICKS = Math.round(64 * 0.6)` keeps dashed trail segments visible for about 0.6 seconds.
- Before detonation, only the recent rolling path window is drawn; older dashed segments disappear.
- After detonation, the remaining dashed trail fades out within about 0.6 seconds while the active effect zone is drawn between `DetonationTick` and `FadeTick`. Decoys draw only their active labeled endpoint dot, with no surrounding effect zone.
- Nearby no-trajectory pop/explosion events are matched against trajectory-backed nades and used as the canonical `DetonationTick`, `FadeTick`, and endpoint.
- Smoke matching expects a trajectory-backed destruction record approximately `SMOKE_EFFECT_TICKS = 1152` ticks after its `SmokeStart` event and allows a `SMOKE_MATCH_TICK_TOLERANCE = 384` deviation around that expected offset. This prevents a later smoke from being preferred merely because its start tick is numerically closer to an older smoke's destruction tick.
- Decoy matching uses the wider smoke-style tick window because the lifecycle event starts when the decoy begins and the projectile-destroyed trajectory can arrive when it expires. `DecoyStart`/`DecoyExpired` define the active brown endpoint dot; older parsed data can infer the landing tick from the stationary end of the trajectory.
- Trajectory-backed duplicate effect zones are skipped when a matched pop/explosion event exists, preventing HE explosions from appearing once at the event tick and again later from the projectile-destroyed record.
- Event-only nades without a usable start position do not draw a fake origin-to-end path.
- Uses `ctx.save()`/`ctx.restore()` with `globalAlpha` to avoid affecting subsequent draws.

Color coding by nade type:
- Smoke: `#9ca3af` (grey)
- HE: `#f97316` (orange)
- Flash: `#fde047` (yellow)
- Molotov: `#dc2626` (red)
- Decoy: `#92400e` (brown)

Player labels in `PlayerLayer.svelte` show the player name above the current weapon label. Alive players also get a white radar-style sight cone computed from interpolated `yaw` to indicate look direction.

### 4.5 Team Color Convention

| Team | Demoinfocs Constant | Color | Hex |
|---|---|---|---|
| Terrorist (T) | `common.TeamTerrorists` (2) | Orange | `#f97316` |
| Counter-Terrorist (CT) | `common.TeamCounterTerrorists` (3) | Blue | `#3b82f6` |
| Spectator | `common.TeamSpectators` (1) | Grey | `#6b7280` |
| Dead Terrorist | `common.TeamTerrorists` (2) | Orange | `#f97316` |
| Dead Counter-Terrorist | `common.TeamCounterTerrorists` (3) | Blue | `#3b82f6` |

Team colors are resolved via `getPlayerTeam(steamId)` in `PlayerLayer.svelte`, which looks up `replayData.players` by SteamID for the `.team` field (not the weapon prefix heuristic used in earlier versions). T=2 → orange, CT=3 → blue.

### 4.6 Kill Feed Icon Format

The kill feed renders `{KillerName} {WeaponIcon} {HeadshotIcon?} {FlashAssistIcon?} {VictimName}`. Weapon names are mapped to SVGs in `static/equipment-icons` through `src/lib/equipment-icons.ts`; for example, `AK-47` uses `ak47.svg`. Headshots use `icon_headshot.svg`, and kills whose parsed `AssistedFlash` flag is true use `flashbang_assist.svg`. Unknown/world weapons use the generic `icon-death.svg` fallback so the feed remains icon-only.

---

## 5. Tauri v2 Specifics

### 5.1 Sidecar Configuration

The sidecar binary must be at:
- macOS/Linux: `src-tauri/binaries/cs2-parser-{target-triple}`
- Windows: `src-tauri/binaries/cs2-parser-{target-triple}.exe`

Target triple for x64 Windows: `x86_64-pc-windows-msvc`

Tauri automatically finds the correct binary based on the platform. See: https://v2.tauri.app/develop/sidecar/

### 5.2 Tauri IPC Command (invoke) — Temp File Approach

**Problem:** Protobuf data for a full demo can be 50-100 MB. Sending this through Tauri IPC serialized as JSON (even base64) is slow and memory-intensive.

**Solution (implemented):** The Rust `parse_demo` command runs the Go sidecar, captures base64 stdout, decodes to bytes, writes to a temp file, and returns the file path. The frontend reads the file directly via `@tauri-apps/plugin-fs`.

This avoids passing large binary data through the IPC bridge. The temp file is cleaned up by the OS on reboot.

### 5.3 File Dialog (Custom Tauri Command)

The frontend calls a custom `open_file_dialog` Tauri command that uses `tauri-plugin-dialog` internally with a `oneshot` channel pattern.

### 5.4 Why Tauri over Electron

Given the pre-loaded 50 MB binary data in memory:
- **Tauri**: WebView2 is native, memory overhead ~50 MB base + 100 MB decoded data
- **Electron**: Chromium is ~120 MB base + 100 MB decoded data

Tauri also produces a smaller installer (5-10 MB vs 150+ MB).

---

## 6. Protobuf Notes

### 6.1 Why Protobuf (not JSON)

| Factor | JSON | Protobuf |
|---|---|---|
| 150K player frames encoding | ~500-800 MB | ~43 MB |
| Deserialization time | ~500ms (JS `JSON.parse`) | ~50ms (binary parse) |
| Memory in browser | String interning causes ~2x overhead | TypedArray views, zero-copy |
| Type safety | Manual types | Generated TS types |
| Schema evolution | Manual | Built-in (field numbering) |

### 6.2 @bufbuild/protobuf (protobuf-es) vs google-protobuf

Use `@bufbuild/protobuf` (formerly protobuf-es). It's modern, tree-shakeable, produces idiomatic TypeScript, and is actively maintained by Buf.

### 6.3 Protobuf Handling of PlayerFrames

The ReplayData protobuf schema contains a DemoHeader, repeated PlayerInfo, repeated RoundData, repeated KillEvent, repeated NadeEvent, repeated PlayerFrame, MapData, repeated FlashEvent, repeated NoiseEvent, repeated BombEvent, and repeated DroppedEquipment. Each PlayerFrame stores tick, steam_id, x/y/z coordinates, yaw/pitch, health, armor, weapon, and is_alive. Each DroppedEquipment record is a compact visibility segment with start/end ticks, equipment name, weapon/utility category, and world position. Re-parse the original `.dem` to populate dropped equipment; older protobuf files decode the new list as empty.

`KillEvent` includes the parser's `assisted_by_flash`, `assister_steam_id`, `attacker_blind`, `killer_airborne`, `no_scope`, `through_smoke`, and `penetrated_objects` data so the kill feed can reproduce conditional CS2 kill indicators and name a flash assister. Older protobuf files decode the added fields as zero/`false`; re-parse the original `.dem` to populate them. `FlashEvent`, `NoiseEvent`, and `BombEvent` are parser-backed event streams used by the current UI:
- `FlashEvent`: flashed player, attacker, duration, and end tick. Re-parse demos to populate it.
- `NoiseEvent`: sound origin, radius, identity, type, and end tick for noise-radius rendering. Current parser-backed types are `running`, `jump`, `shooting`, and `falling`; older empty, `sound`, or `footstep` values are treated as `running` by the frontend.
- `BombEvent`: plant, explosion, defuse start/abort, and defuse completion events used by bomb labels and timeline markers.

Protobuf uses **varint encoding for ints and float32 for positions**. Each `PlayerFrame` is ~40-50 bytes in protobuf. 1.5M frames × 45 bytes = ~68 MB for the frames alone.

**Optimization:** Columnar storage (packed repeated fields per attribute instead of per-row messages) reduces overhead by ~60% but makes querying "get player X at tick Y" harder. **For v1, row-oriented storage is used; it's simpler and good enough at ~68 MB.**

---

## 7. Known Pitfalls & Edge Cases

### 7.1 Map Name in Demo Header

The `map_name` field from the header may differ from the file name used for radar images:
- Demo says `de_dust2` → radar file is `de_dust2.png` ✓
- But could be `de_dust2_vertigo` → map is Vertigo
- Use a lookup table: map the header string to the radar filename

### 7.2 Empty Player Names

Rarely, the demo may not contain player name string table entries (corrupted header). Fallback: `"Player {steamID64}"`.

### 7.3 Player SteamID64 Missing

Some community servers don't log Steam IDs. The value will be 0. Use player index (slot number) as fallback identifier.

### 7.4 Partial Demos (Ongoing Match)

If parsing a demo from an in-progress game, `p.Parse()` returns EOF at the end of the recorded data. The game state is partial. Your UI should handle:
- No rounds ending (all rounds show as "in progress")
- Players without complete stat data
- Gracefully show whatever data was parsed

### 7.5 Demos with No Kills

Extremely rare (warmup, early disconnect), but possible. All kill-related UI elements should gracefully render nothing:
- Kill feed: empty
- Death markers on map: none
- Kill count in stats panel: 0
- Timeline: no kill tick marks
- Kill feed click targets and selected-player kill/death markers: none

### 7.6 Demos with No Nades

Possible in very short demos or warmup-only recordings. Nade layer renders nothing. No error.

### 7.7 Demos with No Rounds

Warmup demos may have no rounds. Show the initial map with all players in spawn positions. Timeline shows no round segments.

### 7.8 Player Disconnections

Players who leave mid-game:
- Present in `Participants().All()` but marked as disconnected
- Their stats only include rounds they played
- Their dot disappears from the canvas after disconnect tick
- Their name still appears in the stats panel

### 7.9 Multi-Map Demos (BO3/BO5)

Deferred to v2, but the data structures should accommodate it. The `DemoHeader` includes a `map_name`. If a demo contains two maps (rare), the parser handles it as one continuous stream. Your code should detect map changes via map name changes and either warn the user or handle the switch.

### 7.10 Bots

Demos may fill empty slots with bots. Bot players:
- Have SteamID64 = 0 or special bot value
- Name is usually "Bot" or "BOT Name"
- You can filter them out or show them with a special indicator
- They don't affect ADR/KAST calculations

**Recommendation:** Show bots but indicate them with `[BOT]` prefix in name. Or filter them out if cluttering the interface.

### 7.11 Kill Events Without Killer

Suicides (fall damage, self-nade, world damage):
- `kill.Killer` may be nil
- `kill.Weapon` will be "World" or name of the damaging entity
- Handle this in the kill feed display: `{Victim} [World]` or `{Victim} [Falling]`

### 7.12 Team Kill / Team Damage

In competitive: team damage doesn't happen (friendly fire is reflected).
In casual/community servers: team kills may occur. Show them with a `(TK)` annotation.

### 7.13 Nade DetonationTick/FadeTick Must Be Set

The `GrenadeProjectileDestroy` event fires for ALL grenade types. If `recordNadeDestroyed` (backend `parser.go`) doesn't set `DetonationTick` and `FadeTick`, these fields default to `0` in proto3.

In the frontend (`NadeLayer.svelte`), `getActiveNades()` filters by `detTick <= currentTick && currentTick < fadeTick`. At `currentTick=0`, an implementation without positive-tick guards could make nades with `detonationTick=0` and `fadeTick=0` behave incorrectly on load.

**Fix:** `recordNadeDestroyed` must always set `DetonationTick = p.CurrentFrame()` and a valid `FadeTick`. Smoke, HE, flash, and decoy projectile records use their type-specific handling. Molotov/incendiary projectile destruction marks the end of that projectile (`FadeTick = DetonationTick`) and must not begin another seven-second ground effect. The frontend also guards with `detTick > 0 && fadeTick > 0` as a safety net.

### 7.14 Inferno Expiry Is Authoritative

Molotov and incendiary ground fire receives a nominal seven-second (`448` tick) inferno lifecycle, but smoke can extinguish it immediately or at any point during that lifetime. The parser therefore registers `events.InfernoStart` and `events.InfernoExpired`, stores the lifecycle event by `Inferno.UniqueID()`, and replaces that inferno's nominal fade tick with the observed expiry tick. This handles both smoke thrown onto active fire and fire landing in an existing smoke without relying on approximate frontend distance checks. Projectile destruction never starts a second fire lifetime. The trajectory record and lifecycle record are paired only when the lifecycle starts no later than the projectile destruction and is no more than 448 ticks earlier, with endpoint proximity prioritized. Older sidecars that encoded `destroy tick + 448` are interpreted as ending at the destroy tick and are clamped to at most the preceding seven seconds.

---

## 8. Development Environment Setup

### 8.1 Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Go | 1.26.3+ | Compile parser |
| Rust | 1.80+ (edition 2021) | Compile Tauri shell |
| Node.js | 20 LTS+ | SvelteKit build (Svelte 5) |
| pnpm | 9+ | Package manager |
| protoc + buf | latest | Protobuf code generation |
| WebView2 | Installed on Win10+ | Tauri runtime |
| Git | latest | Version control |

### 8.2 Quick Setup Commands

Install commands: winget for Go, Rust, and Node.js LTS; then `npm i -g pnpm`, `go install buf`, `pnpm add -g @tauri-apps/cli`. Tauri v2 on Windows also needs Microsoft Visual Studio Build Tools. Verify with `go version`, `rustc --version`, `pnpm --version`, `buf --version`, `cargo tauri --version`.

### 8.3 Build & Run Commands

Development server commands are intentionally not run by the agent. Build protobuf: `cd proto && buf generate && cd ..`. Build Go sidecar: `cd backend && go build -o ../src-tauri/binaries/cs2-parser-x86_64-pc-windows-msvc.exe . && cd ..`. Check Rust: `cd src-tauri && cargo check`. Check frontend without auto-fixing when needed. Never run `npx @sveltejs/mcp svelte-autofixer` or any other Svelte autofixer command.

---

## 9. Reference URLs

### Library & Documentation
- demoinfocs-golang: https://github.com/markus-wa/demoinfocs-golang
- Go API docs: https://pkg.go.dev/github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs
- Events package: https://pkg.go.dev/github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events

### Tauri v2
- Tauri v2 docs: https://v2.tauri.app/
- Sidecar docs: https://v2.tauri.app/develop/sidecar/
- File dialog: https://v2.tauri.app/plugin/dialog/
- IPC docs: https://v2.tauri.app/develop/calling-rust/

### Protobuf
- protobuf-es (JS/TS): https://github.com/bufbuild/protobuf-es
- Buf CLI: https://buf.build/docs/cli

### Map Data Sources
- cs2-map-icons: https://github.com/MurkyYT/cs2-map-icons
- CS2 equipment SVG icons: https://github.com/Juknum/counter-strike-icons/tree/main/cs2/panorama/images/icons/equipment
- Source 2 Viewer (VRF): https://github.com/ValveResourceFormat/ValveResourceFormat

### Projects Using demoinfocs-golang (Reference)
- cs-demo-minifier: https://github.com/markus-wa/cs-demo-minifier

### CS2 Specific
- CS2 map overviews (Valve): in VPK at `/resource/overviews/{map}.txt`
- CS2 radar images: in VPK at `/panorama/images/overheadmaps/`

---

## 10. Questions the AI Should Ask If Uncertain

If these questions arise during implementation, escalate to the human:

1. **Exact field names in events.** The API docs are authoritative. If documentation contradicts examples in the README, trust the docs.
2. **Go sidecar vs FFI.** If the sidecar approach has latency or data-size issues, consider Tauri's `commands: async` with direct Go FFI or a gRPC bridge.
3. **CS2 demo test files.** For testing, placeholder `.dem` files don't exist. Use real demos from HLTV.org or your own CS2 replays. The parser will work with any valid CS2 `.dem` file.
4. **Radar image licensing.** Valve's map images are part of the game assets. Using them in a free/open-source tool is generally acceptable, but check Valve's guidelines if distributing commercially.
5. **Tauri v2 vs v1.** v2 is used. If any referenced API doesn't exist in v2, search the v2 documentation.
6. **Columnar vs row-oriented protobuf.** If 68 MB of protobuf frames causes memory issues on low-end machines, switch to columnar storage.
7. **Nuke/Vertigo multi-level.** If players appear on top of each other (X,Y same but Z different), add Z-level indicator or let user toggle levels.

---

## 11. Project Architecture Overview

### 11.1 Data Flow

`.dem` file → Go sidecar parses it → base64 stdout → Rust Tauri command decodes and writes temp file → Frontend reads file → deserializes protobuf → layered Canvas 2D renderers display the replay

### 11.2 Layered Canvas Architecture

The active UI uses stacked `<canvas>` elements organized into logical layers. `PlayerLayer.svelte` owns separate base and sight canvases so sight-control changes remain cheap:

| Layer | Component | Responsibility |
|---|---|---|
| Map | `MapLayer.svelte` | Loads radar PNG, draws background/grid, applies `worldToCanvas()` transform |
| Player base | `PlayerLayer.svelte` | Draws player dots, weapon labels, health bars, trails, flash indicators, noise, and bomb state |
| Player sight | `PlayerLayer.svelte` | Draws sight cones and line-of-sight rays independently from the heavier player base |
| Nade | `NadeLayer.svelte` | Draws nade trajectories, active smoke/fire zones, and fading Flashbang/HE/Decoy destination icons with map hit testing |
| Dropped equipment | `DroppedEquipmentLayer.svelte` | Draws non-interactive icons for unowned weapons and utilities while their recorded ground-position segment is active |
| Kill | `KillLayer.svelte` | Draws death markers (X on victim position) and the clickable, icon-based kill feed overlay |
| Drawing | `DrawingLayer.svelte` | Stores and draws Shift-activated freehand tactical annotations |

*Note: `ReplayCanvas.svelte` and `renderer.ts` are legacy from an earlier single-canvas approach. Active rendering is done by the dedicated layer components above.*

### 11.2.1 Round-Specific Player Trails

Player ghost path trails are filtered to only show frames within the **current round** (the round containing `currentTick`). Implemented in `PlayerLayer.svelte` via `getCurrentRoundRange()` and the local trail cache. Round detection uses `src/lib/replay/rounds.ts`, so the current round includes the 7-second post-round display window. The render loop applies both the round-range filter and the existing `trailLength` cap (128 frames). If `currentTick` is not inside any round (warmup, between rounds), all frames up to `currentTick` are shown.

### 11.2.2 Nade Size Constant

Nade effect zones and projectile indicators were reduced to **1/4 of original size** (July 2026). Current radii in `NadeLayer.svelte`:
- All projectile circles: **25** (was 100)
- Smoke effect zone: **45** (was 50; approximately 10% smaller)
- HE effect zone: **62** (was 250)
- Flash effect zone: **200** (was 400; doubled from the previous 100px viewer radius)
- Molotov effect zone: **38** (was 150)
- Flashbang, HE grenade, and Decoy destination markers: **14px equipment icon inside a 30px color-coded marker**, beginning at 50% opacity and fading out over 5 seconds

Smoke effect-zone fill opacity is **45%** (was 35%), making it 10 percentage points less transparent.

Active smoke and Molotov/incendiary effect zones display a centered SVG plus a whole-second countdown in `NadeLayer.svelte`. Smoke uses `map_smoke.svg` at 56px (twice the original 28px); both Molotov and incendiary use `inferno.svg` at 42px (approximately 50% larger) and 50% opacity. The text is derived from the canonical fade tick at 64 ticks per second and is drawn over the icon as `XXs` until the effect is removed. Every fire countdown is hard-capped to `7s`/`448` ticks from its canonical start. For newly parsed demos, the canonical fire fade tick comes from the matched `InfernoExpired` lifecycle record, so smoke-extinguished fire is removed immediately. Older destroy-based records are treated as ending—not starting—at their recorded destroy tick. Smoke countdown labels are light green (`#86efac`); Molotov/incendiary countdown labels are gray (`#9ca3af`). Both labels use a dark outline to remain legible over the icon, effect fill, and radar background. SVG images are cached after browser decoding and trigger a redraw when ready.

Smoke and fire effect areas are interactive for their full visible lifetime. A single click copies the same two-second lead-in `demo_goto` command used by timeline markers; a double-click cancels that copy action, selects the thrower, and seeks to two seconds before the throw. Flashbang, HE grenade, and Decoy destinations receive equivalent interactive icons for five seconds after landing, with yellow, orange, and brown marker colors respectively. Their equipment art is half the former size and the complete marker begins at 50% opacity before fading. Trajectory/effect record matching ensures these interactions use the original throw tick rather than the detonation or expiry tick.

### 11.2.3 Kill Feed Position

The kill feed text overlay in `KillLayer.svelte` starts at `canvasSize.height - 80` (was `- 20`) to prevent overflow beyond the bottom edge of the viewport. It also accepts `feedLeftOffset`; `+page.svelte` passes `312` so the kill feed text and click hitboxes start to the right of the left controls panel. This prevents the controls panel from covering the kill feed after the sight/noise sections were added.

### 11.3 Per-Tick Frame Lookup (Optimized)

The parser emits a `PlayerFrame` for every player on every tick via `events.FrameDone`. The frontend filters frames client-side in `PlayerLayer.updatePlayerFrames()`.

**Previous approach (removed):** Rebuilt a `Map<string, PlayerFrame[]>` from all 1.5M frames every single tick, then iterated per-player to find the closest frame at or before `currentTick`. This was O(N) per tick and blocked the event loop.

**Current approach:** Uses an index-tracking cursor per player. On forward playback the cursor advances linearly. When seeking backward (e.g., timeline click), binary search finds the correct frame.

The per-player `trails` map is built once in `initializeTrails()` (called when `replayData` changes). This separates the one-time initialization from the per-tick lookup.

**Smooth movement:** `PlayerLayer.svelte` now reads the fractional playback tick from `playback-state.ts` and interpolates X/Y/Z, yaw, and pitch between the current `PlayerFrame` and the next one. This makes player dots move smoothly between sampled demo ticks instead of teleporting from one integer-tick position to the next. Interpolation is capped for large frame gaps so disconnects, missing samples, or round transitions do not smear players across the map.

### 11.4 Playback Loop (requestAnimationFrame)

The playback loop is managed via a `requestAnimationFrame` loop in `+page.svelte`. Each frame computes the target tick from elapsed time multiplied by tick rate and playback speed. During playback, the computed tick is written to the non-reactive module-level clock in `src/lib/playback-state.ts` instead of assigning a Svelte prop/state value every tick. On play, if the current tick is inside a round's freezetime, it jumps to the active start (post-freezetime) immediately.

**Per-round playback cap:** The loop stops at the current round's effective display end tick from `src/lib/replay/rounds.ts`, not directly at the raw `round.endTick`. This includes the 7-second post-round tail for bomb, timeout, defuse, and elimination conclusions, while still preventing playback from bleeding into the next round. If no round is active, it falls back to the total ticks from the demo header.

**Reference sync pattern:** The tick setter resets the playback reference tick and time when called during playback, so time-based calculation continues cleanly after seeks (timeline click, event marker click, kill-feed click, round navigation). This ensures seeking during playback doesn't cause jumps. Explicit seeks call `setPlaybackTickAndNotify()`, so canvas layers repaint immediately even though `currentTick` is no longer passed through the Svelte component tree every frame.

**Display throttling:** The reactive UI uses `displayTick`, which is updated at a lower cadence (~100ms) during playback and immediately on explicit seeks/pause. This keeps `TimeDisplay`, the timeline, and `RoundNav` responsive without re-running Svelte effects 64-192 times/sec.

### 11.5 Svelte 4 Reactivity Pattern (Critical Gotcha)

In `$:` reactive statements, using an array literal as a dependency list is broken — the function is never called reactively. The correct pattern uses an immediately-invoked block with explicit `void` dependency references. The `void` expression forces Svelte to track the variables read inside it as dependencies. Without it, variables used only inside called functions are not tracked as dependencies.

### 11.6 Radar Assets and Map Calibration

The viewer now uses radar assets and overview metadata from `MurkyYT/cs2-map-icons`. Only radar-related files are bundled:

- Radar PNGs are stored in `static/maps/<map>.png`
- Raw overview files are stored in `static/maps/radar_info/<map>.txt`
- Lower-level radar variants are stored for maps whose overview declares vertical sections: `de_nuke_lower.png`, `de_train_lower.png`, and `de_vertigo_lower.png`
- Parsed metadata lives in `src/lib/maps/radar-info.ts`

`+page.svelte` no longer uses the old hardcoded `MAP_COORDINATES` table. When a replay is loaded, `fillMapMetadata()` resolves the demo map name against `RADAR_INFO_BY_MAP` and creates protobuf `MapData` from the bundled MurkyYT values. This intentionally overrides the parser's placeholder map metadata, which currently only contains the map name plus a generic scale.

The old visual Map Alignment panel was removed. Player, nade, kill, and map layers all use the same overview transform now, so the background radar should not be independently offset or stretched. If a map ever needs calibration, adjust the per-map `posX`, `posY`, or `scale` values in `src/lib/maps/radar-info.ts` instead of applying visual canvas offsets.

`MapLayer.svelte` loads the radar image through `getRadarInfo(mapName).imagePath` and reloads it whenever the normalized map name changes. `worldToCanvas()` and `MapLayer.svelte` both use the shared `MAP_CANVAS_MARGIN` constant so the fitted radar rectangle and gameplay overlays stay aligned.

For maps with lower radar variants (`de_nuke`, `de_train`, `de_vertigo`), the bottom controls bar shows `Normal` and `Lower` toggle buttons. `Normal` is selected by default. `Lower` only swaps the map background image to the lower PNG from `verticalSections.lower.imagePath`; player, nade, kill, and bomb overlays keep using the same world-to-radar transform.

### 11.6.1 Equipment Icon Assets

CS2 equipment SVGs are stored in `static/equipment-icons` and are used by the kill feed, timeline markers, and utility effect centers. They come from the `cs2/panorama/images/icons/equipment` directory of [Juknum/counter-strike-icons](https://github.com/Juknum/counter-strike-icons/tree/main/cs2/panorama/images/icons/equipment). The empty source files `world.svg` and `worldent.svg` are intentionally not bundled. Shared asset paths and the demoinfocs weapon-name mapping live in `src/lib/equipment-icons.ts`.

### 11.7 Playback Speed Controls

Four speed options are available in the controls bar: 0.5x, 1x (default), 2x, 3x. The `playbackSpeed` variable (default `1`) is read directly by the playback loop function — changing speed takes effect immediately without restarting the rAF loop. Since the target tick is computed from elapsed time, tick rate, and playback speed, any speed change naturally affects the next frame's calculation.

### 11.8 Per-Round Timeline & Freezetime Skip

The timeline is scoped to the **current round's active phase** (after freezetime ends), not the full match. This makes seeking precise within a round.

**Freezetime skip and replay reload:** Freezetime is automatically skipped on round start via three mechanisms:

1. **Go parser** (`backend/parser/parser.go`): Registers a handler for `events.RoundFreezetimeEnd` which records the exact tick on `RoundData.FreezetimeEndTick`. Since CS2 freezetime varies (15–20 seconds), the actual game event is authoritative.

2. **Frontend fallback** (`+page.svelte` `getRoundActiveStart()`): If `freezetimeEndTick` is 0 (old parser data), computes it as `startTick + 960` (~15 seconds at 64 tick).

3. **Play button auto-skip**: When pressing play before the first round, between rounds, or inside freezetime, playback chooses the next playable round and jumps to `activeStart` immediately.

**Timeline behavior:**
- 0% = `freezetimeEndTick` (round active start)
- 100% = effective display end tick from `getRoundDisplayEndTick()`
- Clicking the left edge of the timeline seeks to `freezetimeEndTick`
- `seekToRound()` seeks to `getRoundActiveStart(round)` (not `round.startTick`)
- Time display shows time relative to `activeStart` (`0:00` when round enters active phase)
- Keyboard arrow seeking is intentionally disabled. The focused timeline only handles Enter/Space as activation keys.
- When no round is active (warmup, between rounds), falls back to full-match range

Knife rounds: the Go parser detects an initial knife-only round by sampling alive T/CT player inventories during the first parsed round, not only at `round_start`. A first round is considered knife-only only if enough player inventories are observed with knives and no non-knife evidence appears; non-knife inventory, non-knife kills/damage, weapon fire, nade activity, or bomb events prevent the skip. Ignored inventory equipment for this check includes C4, armor/helmet, and defuse kit so the decision is based on carried weapons rather than the currently equipped weapon. The first knife-only round is removed from serialized `ReplayData.rounds`, and visible rounds are renumbered. `+page.svelte` seeks to the active start of the first visible round immediately after replay load.

The bottom controls toolbar includes a left-aligned `Load Demo` button. It opens the same `.dem` picker as the empty state. Once a new file is selected, `+page.svelte` stops playback, clears the current `ReplayData`, resets player/timeline/bomb/viewport caches, waits for Svelte to unmount old replay layers, then parses and loads the new protobuf. Cancelling the picker leaves the current replay untouched.

Round navigation survivor labels: `RoundNav.svelte` counts alive T and CT players at the effective display end tick, not just the raw winner-side count at the original round end. Labels are formatted as `T + N | CT + N`, a single side when only one side has survivors, or `No Survivors`. Hovered or keyboard-focused round buttons use the same white outline, brightness increase, side-colored glow, and scale treatment as timeline markers.

### 11.9 Kill Feed & Death Marker Round Filtering

Both the kill feed and death markers filter kills to only show those within the current round (the round containing `currentTick`). Round detection uses the effective display end tick, so kills in the 7-second post-round window remain visible and can affect survivor counts. Previously they showed kills from all rounds combined.

The kill feed shows at most 10 kills that have already happened in the current round (`kill.tick <= currentTick`), so future kills are not visible early. Death markers still use the short recent-kill window (`currentTick - 64 <= kill.tick <= currentTick`) so the red X appears briefly at the moment of death.

Kill feed player names are color-coded by team at that round: CT names are blue (`#3b82f6`) and T names are orange (`#f97316`). Kill metadata is rendered as an icon sequence drawn from `static/equipment-icons`, including the weapon, headshot, blind-killer, flash-assist, airborne, no-scope, through-smoke, and penetration indicators. `KillLayer.svelte` caches the browser-decoded SVG images and redraws after each asset loads while preserving the existing row hitboxes and click-to-seek behavior.

### 11.10 Player Roster, Sight Controls, Selection Zoom, and Event Markers

`PlayerLayer.svelte` only indexes and renders Steam IDs present in `ReplayData.players` whose stored team is T or CT. Observer/admin/spectator frame samples are ignored, so only real player dots are drawn.

The player sight cone defaults to `75` canvas pixels long and `0.68` radians wide. `+page.svelte` exposes a compact top-left `Sight` panel below the time display. It includes `Show Sight Cone` (checked by default), `Show for selected Player` (unchecked by default), a width slider, a sight cone length slider with max `240`, and a `Show Line of Sight` checkbox. Line-of-sight controls follow the same order as sight-cone controls: `LOS Width` first, then `LOS Len`. `LOS Width` defaults to `1.6px`, ranges from `0.3` to `3.0`, and steps by `0.1`; `LOS Len` defaults to `300` and ranges from `18` to `800`. The panel scrolls vertically within the viewport so it does not collide with the bottom toolbar.

The `Player Selection` section below the sight controls contains only a zoom percentage slider capped at `500%`; there is no enable checkbox. Clicking a player dot, roster name, kill-feed row, or player-backed timeline marker automatically selects and focuses that player at the configured zoom. A new selection first resets independent mouse-wheel zoom and pan, then applies the selected-player transform, guaranteeing that the player dot is centered instead of inheriting a stale mouse translation. While a player is selected, mouse-wheel input changes `selectedPlayerZoomPercent` directly and keeps that player centered; mouse-position zoom is used only when no player is selected. The page writes `--replay-viewport-transform` directly on the replay container from the playback tick, and map/player/nade/death-marker/dropped-equipment/drawing canvases inherit that CSS transform. Clicking the selected player again, clicking empty canvas space, or beginning a left-button canvas drag clears the follow target while retaining the current viewport so dragging can continue immediately.

When no player is selected, the replay viewport supports independent mouse-wheel zoom over the canvas. It starts at the unzoomed view (`0%` additional zoom / `1×` scale), is capped at `500%` (`5×` scale), and keeps the point under the mouse fixed while zooming. Holding the left mouse button and dragging pans the viewport at every zoom level, including the fitted `1×` view and after a selected player is deselected. Wheel, pointer, and click interactions are attached directly to the replay container instead of `window`; the wheel listener is explicitly non-passive so it can prevent browser scrolling without Chromium intervention warnings. The pan boundary combines 50% of the viewport dimension with 25% of the scaled map dimension, allowing substantial movement in every direction at both low and high zoom without losing the map completely. Loading a different replay resets this mouse viewport zoom and pan.

The `Noise` section below `Player Selection` contains `Show Noice Circle` (unchecked by default), `Noise for Selected Player` (unchecked by default), and per-source checkboxes for the distinguishable sources `Running Noise`, `Jump Noise`, `Shooting Noise`, and `Falling Noise` (checked by default). `Show Noice Circle` is the master visibility toggle for red noise circles. `Noise for Selected Player` limits noise rendering to the selected Steam ID. Unknown noise types are not exposed as a separate UI option.

The `Timeline` section below `Noise` controls timeline marker visibility only; it does not change utility rendering on the map. `Show Kills` and `Show Deaths` are checked by default and control the domination/death icon markers. `Show all Utilities` is unchecked by default. `Show Smokes`, `Show Flashes`, `Show HE Nades`, `Show Molotovs`, and `Show Decoys` are checked by default. When `Show all Utilities` is off, kill/death and utility markers are limited to the selected player and respect their filters. When `Show all Utilities` is on, the timeline shows all checked utility types plus all checked kill/death markers that happened during the current round. Bomb plant, explosion, defuse, and time-expiry markers remain visible regardless of filter settings.

The `Dropped Equipment` section immediately above `Drawing` contains `Show Dropped Weapons` and `Show Dropped Utility`, both checked by default. Each checkbox independently filters the matching icon category. `DroppedEquipmentLayer.svelte` renders only parser-reported unowned weapon entities that include an exact world position and active tick range; no player-position, death-position, inventory, or synthetic fallback is allowed. A real entity-backed visibility segment ends when the item is picked up, moves more than four world units, disappears, or the round's seven-second post-win display window finishes. Movement begins a new segment at the entity's newly reported position. When the round-end event removes world entities, their last exact positions are retained through `RoundData.EndTick`, which is the event tick plus seven seconds. Grenade projectiles/effects remain owned by `NadeLayer.svelte` and are independent of ground-item parsing.

The `Drawing` section controls a separate freehand drawing overlay. `Left Mouse Color` defaults to CT blue (`#3b82f6`) and `Right Mouse Color` defaults to T orange (`#f97316`). Hold <kbd>Shift</kbd> and drag with either mouse button to draw with its assigned color; the right-button context menu is suppressed during Shift drawing. `Stroke Width` ranges from 1 to 10. `Permanent` retains strokes until `Clear all Drawings` is clicked or another round is selected. `Fade` reveals a `Fade in s` slider from 1 to 6 seconds; completed strokes then fade smoothly to transparent over the selected duration. Releasing Shift immediately finalizes the active stroke and releases pointer capture so normal player selection and mouse-zoom panning resume.

The top-right roster panel shows two current-round side columns, CT and T, with alive/total counts in the headers. It uses the same stored-team side-switch logic as the canvas renderers, so the columns flip after halftime and every overtime half. Player names are side-colored while alive and greyed out when dead at the current tick. Hovered or keyboard-focused roster buttons use the same white outline, brightness increase, player-color glow, and scale treatment as timeline markers.

The top-center match score label is formatted as `Team <playerName> (XX) vs Team <playerName> (XX)`. The representative names are selected from the two sides in the first visible round and remain stable after side switches. Round wins are counted by mapping each completed round winner back to that first-round team identity, so users do not have to manually add T-side wins before halftime and CT-side wins after halftime. Each `Team <playerName> (XX)` segment is colored by that team's current side in the shown round: blue for CT and orange for T. Its top position follows the computed timeline height, preventing vertically stacked event markers from overlapping the score. The score and all bomb-status/win labels explicitly disable text selection so a mouse drag over them cannot interfere with viewport panning.

Clicking a player name or a living player dot selects and automatically centers that player; clicking the currently selected player again clears the selection while retaining the current camera transform. Selection is cleared automatically as soon as the selected player's current frame becomes dead. Dead players render `icon-death.svg` in their side color—orange for T and blue for CT—and never render a health bar. A single click on a dead-player icon only copies `demo_goto <Tick>` for three seconds before that death; a double-click cancels the pending copy, selects the dead player, and seeks to the same three-second lead-in where that player is still alive. Player hit testing uses the current playback tick and the inverse viewport transform, so it remains available while playback is running and while either viewport zoom is active. Kill-feed and grenade-interaction hitboxes take precedence over player interaction. Selected alive players use green (`#22c55e`) for the dot, sight cone, and line-of-sight ray.

All active replay canvases size their backing buffers from untransformed `clientWidth`/`clientHeight`, never from transform-inflated bounding rectangles. This prevents maximizing a zoomed application window from shrinking the rendered radar until the window is restored.

Sight-cone and line-of-sight geometry render on a dedicated transparent canvas inside `PlayerLayer.svelte`. Slider changes schedule only this lightweight overlay instead of redrawing trails, kill markers, noise, bomb state, labels, health bars, and player dots. Playback still updates the base player canvas and sight overlay from the same interpolated frame lookup, preserving alignment while removing the heavy slider-drag lag.

Selecting a player shows round event markers under the timeline for that player's enabled kills, deaths, and grenade throws. Markers use CSS-masked SVGs from `static/equipment-icons`, allowing exact side coloring: T events are orange (`#f97316`) and CT events are blue (`#3b82f6`). Kill markers use the general `domination.svg` icon. Normal deaths use `icon-death.svg`; headshot deaths use `kill_headshot.svg`; both are colored for the victim's side. Utility markers use `smokegrenade.svg`, `flashbang.svg`, `decoy.svg`, `hegrenade.svg`, or `inferno.svg` and are colored for the thrower's side. Both Molotov and incendiary markers use `inferno.svg` for better legibility. Bomb plant, explosion, and defuse markers use orange `c4.svg`, orange `exploded_c4.svg`, and blue `defuser.svg`, respectively. A round won because time expired (`target_saved`, with `time_ran_out` accepted for compatibility) always adds `time_exp.svg` at the actual round-ending tick; it is orange for a T win and blue for a CT win. Plant timing prefers the parsed completed-plant event, falls back to `plant_begin + plant duration` when available, and finally falls back to `objective end - bomb timer`; explosion and defuse use parsed events when available and otherwise fall back to round win reason.

Markers use the current round's active-start timeline scale and are packed by their actual horizontal screen position. Each marker is placed into the first lane where its 24px icon plus a 4px gap does not collide with the previous marker; a lower lane is created only when horizontal space is genuinely unavailable. The 24px icon sits inside a 28px button, and vertical lanes use a 34px pitch. Marker packing is recalculated on window resize. The timeline height is recalculated from the highest occupied lane for the current round and active filters, and top-anchored UI panels move down by the same amount. Hovered or keyboard-focused markers receive a white outline, brightness increase, colored glow, and slight scale-up. Single-click behavior is unchanged: it seeks to two seconds before the event, clamped to the event round, and selects the killer, victim, thrower, planter, or defuser when applicable. Double-clicking any icon copies `demo_goto <tick>` for the same lead-in tick and shows a short non-blocking, explicitly non-selectable toast.

Timeline markers are cached by round, selected Steam ID, `Show all Utilities`, utility type filters, and kill/death filters. This avoids rebuilding grenade/kill/death marker data on every throttled UI tick during playback. Selected-player zoom is implemented as a DOM/CSS camera update rather than layer props, so normal rendering paths are not invalidated by zoom-follow movement.

Kill feed rows in `KillLayer.svelte` are clickable canvas hitboxes. Clicking a row selects the killer and seeks to 2 seconds before the kill. Each row renders the conditional indicators in replay order: `blind_kill.svg` before a flashed/blind killer, killer name, `+ flashbang_assist.svg` and the flash assister name, `inairkill.svg`, weapon icon, then `noscope.svg`, `smoke_kill.svg`, `penetrate.svg`, the existing headshot icon when applicable, and the victim name. Only the killer, weapon, and victim are mandatory. The feed text and hitboxes are offset to the right of the left controls panel so the panel does not block clicks.

Player selection no longer rebuilds the full replay frame index. Replay frame and grenade indexes are built explicitly once inside `applyLoadedReplay()` and are no longer owned by a Svelte reactive block. Timeline grenade records are deduplicated and indexed by thrower during demo loading, trajectory matches are cached before any selection, and the current filter configuration's per-player/per-round timeline layouts are warmed before the replay becomes interactive. Completed layouts remain cached by round/player/filter/viewport-width key. The selected-player validity check and lightweight timeline display update are isolated from roster/bomb/score work, eliminating replay-wide synchronous work when focus changes.

### 11.11 Flash, Noise, and Bomb Event Rendering

The Go parser records `events.PlayerFlashed`, `events.Footstep`, `events.PlayerJump`, `events.PlayerSound`, `events.WeaponFire`, fall-damage `events.PlayerHurt`, `events.InfernoStart`, `events.InfernoExpired`, `events.BombPlantBegin`, `events.BombPlantAborted`, `events.BombPlanted`, `events.BombExplode`, `events.BombDefuseStart`, `events.BombDefuseAborted`, and `events.BombDefused` into protobuf event arrays. Inferno lifecycle events are represented as matched `NadeEvent` records with their observed fade tick. Existing parsed protobuf files may not contain these arrays, typed noise values, inferno expiry timings, or expanded kill flags; load and parse the original `.dem` again to see parser-backed behavior.

`PlayerLayer.svelte` renders a grey filled circle around flashed players while the flash is active. Opacity now scales with both parsed flash duration and remaining duration, using a full-flash reference of five seconds and a low `0.06` opacity floor. Minimally flashed players therefore receive a much more transparent indicator instead of the former minimum `0.6` opacity, while strong flashes remain prominent and fade over time.

Noise events render as red stroked circles around alive players when `Show Noice Circle` is enabled. The radius is converted through the same radar/world transform as other overlays. Jump and falling noise events render at the event origin and fade with remaining event lifetime. Shooting noise renders around the shooter's current position during its short lifetime. Running noise uses one persistent circle per running player, follows the player's current position, holds briefly while running continues, and fades quickly after running stops.

`PlayerLayer.svelte` also draws a static red `Bomb` dot after a successful plant. The dot uses the planter's position at the completed plant tick, labels it `Bomb`, never moves after planting, and does not emit noise.

`+page.svelte` computes bomb status labels from bomb events. While planting, a centered orange label shows `Planting Bomb Xs` until completion or abort; this requires `plant_begin` events from a rebuilt sidecar and newly parsed demo. While planted, a centered orange label shows `Bomb has been Planted XXs`, where `XX` is the remaining time before explosion. If an older parsed protobuf lacks plant events, planted countdowns fall back to bomb-objective round timing. If a defuse is active, a centered blue label shows `Defusing Bomb Xs`; it is hidden if the defuser dies, aborts, or the bomb explodes. Final states show `Bomb exploded, Terrorists Win!` or `Bomb has been defused. Counter Terrorists Win`; these final labels can fall back to round win reason even if an older parsed protobuf lacks bomb events.

### 11.12 Welcome Screen Donation

The empty Welcome screen presents `Load Demo File` and a PayPal-styled `Donate with PayPal` button in one responsive action row. The donation button opens `https://paypal.me/cliption` in the user's default browser through the already configured Tauri shell plugin and `shell:default` capability; it does not navigate the replay WebView away from the application.

---

## 14. Resolved Performance Issue: Controls Lag During Playback

**Status:** FIXED (July 2026)

### Symptom

All bottom-bar controls (play/pause, speed buttons; previously also prev/next kill buttons) and the round navigation panel felt laggy/unresponsive during playback. Clicks were delayed or missed entirely when the replay was actively playing at any speed.

### Root Cause

The root cause was **Svelte reactivity churn**: every `currentTick` change during playback (64-192 times/sec) triggered `$:` reactive blocks in all child components that received `currentTick` as a prop. Even when those blocks did minimal work, Svelte 5's legacy-mode effect scheduling and prop-diffing added overhead across the component tree: `+page.svelte` -> `PlayerLayer` + `NadeLayer` + `KillLayer` + `TimeDisplay` + `RoundNav`. Combined with canvas rendering in rAF callbacks, the main-thread budget per frame was regularly exceeded.

### Fix Implemented

Playback tick state is now split into two paths:

1. **Render clock:** `src/lib/playback-state.ts` stores the actual playback tick as a plain, non-reactive module variable. `+page.svelte` writes the fractional tick to it every animation frame.
2. **Canvas layers:** `PlayerLayer.svelte`, `NadeLayer.svelte`, and `KillLayer.svelte` no longer receive `currentTick` as a prop. They read `getPlaybackTick()` inside their own rAF render loops while playing, and subscribe to explicit tick notifications for seeks/pause.
3. **Reactive UI:** `+page.svelte` keeps a separate `displayTick` for `TimeDisplay`, timeline progress, and `RoundNav`. This is throttled during playback and updated immediately for user-driven seeks.

This removes the per-tick Svelte prop cascade while preserving responsive controls and accurate canvas playback.

### Player Movement Fix

Player rendering also now uses fractional ticks. `PlayerLayer.svelte` finds the frame at or before the current playback tick, checks the next frame, and linearly interpolates position and view angles when the gap is small. This makes players move smoothly between points instead of snapping/teleporting from frame to frame.

### What Was Tried (Did Not Fix)

#### Attempt 1: rAF-throttled canvas rendering

`PlayerLayer.svelte`, `NadeLayer.svelte`, and `KillLayer.svelte` were changed to use a `scheduleRender()` function that queues canvas drawing via `requestAnimationFrame` with a guard (`rafId`), coalescing multiple tick changes into one render per frame.

**Result:** Marginal improvement. The canvas calls dropped from 192/sec to 60/sec, but the `$:` blocks still fire on every `currentTick` change. The sync overhead of Svelte reactivity itself (prop comparisons, effect scheduling across the component tree) remains at 64-192 Hz.

#### Attempt 2: Trail caching in PlayerLayer

`getPlayerTrail()` was replaced with `updateTrailCache()` + `getCachedTrail()`. Trails are pre-filtered by round range once; a cursor advances O(1) per tick during forward playback instead of re-filtering thousands of frames every render.

**Result:** Negligible improvement. The per-render trail work was not the dominant bottleneck.

#### Attempt 3: Kill cache & RoundNav guard

Kill lists are cached per round key. `RoundNav.updateActiveRound()` is guarded by `lastActiveRound` to avoid DOM `classList.toggle()` on ticks within the same round.

**Result:** No perceptible change.

### Previous Suspected Real Cause

Despite all canvas-level and caching optimizations, **Svelte reactivity itself is the bottleneck**. Every `currentTick` assignment triggers a cascade through the component tree:

1. `+page.svelte` `$:` block (roundProgressPct computation + template re-eval for timeline width/left)
2. `PlayerLayer` `$:` block (updatePlayerFrames + updateTrailCache)
3. `NadeLayer` `$:` block (just scheduleRender now)
4. `KillLayer` `$:` block (just scheduleRender now)
5. `TimeDisplay` template uses `{currentTick - activeStart}` directly
6. `RoundNav` `$:` block (guarded but still checks guard every tick)

On Svelte 5, `$:` blocks compile to `$effect` under the hood. Each prop change triggers effect re-evaluation for every component in the binding chain. Even with no-op effects, the scheduling overhead at 64-192 Hz monopolizes the main thread microtask queue, delaying user input processing between frames. Canvas rendering in rAF callbacks compounds this by consuming the remaining frame budget.

---

## 13. Glossary

| Term | Definition |
|---|---|
| `.dem` | CS2 replay file format (binary) |
| Tick | Game state update at 64 Hz (15.625ms per tick) |
| Freezetime | 15–20s buy phase before round starts (auto-skipped in viewer) |
| MR12 | Match format: first to 12 rounds (standard CS2) |
| ADR | Average Damage per Round |
| KAST | Percentage of rounds with Kill/Assist/Survived/Traded contribution |
| HS | Headshot |
| WB | Wallbang (shot through wall) |
| VPK | Valve Pak — compressed archive format for game assets |
| Hammer | Valve's world coordinate unit (~1 inch or ~2.54 cm) |
| T/spawn | Terrorist spawn |
| CT/spawn | Counter-Terrorist spawn |
| Sidecar | External binary bundled with a Tauri app, callable via IPC |
| Protobuf | Protocol Buffers — binary serialization format by Google |
| Canvas 2D | Browser 2D drawing API (part of HTML5) |
