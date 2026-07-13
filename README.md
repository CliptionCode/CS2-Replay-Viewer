# CS2 Replay Viewer

An open-source 2D and 3D viewer (3D is available from Version 0.2.x) for Counter-Strike 2 replay demos. Load a `.dem` file to replay rounds on an interactive radar or directly inside extracted CS2 map geometry, inspect player movement and utility, and quickly jump to the moments that matter.

> [!IMPORTANT]
> **The 3D View requires at least 8 GB of free (currently available) system RAM.** This is a mandatory requirement—not simply a recommendation—because the application must load and process the CS2 map data, geometry, textures, and replay data. Having 8 GB of RAM installed is not sufficient if less than 8 GB is available when opening the 3D View. Close other memory-intensive applications before using it.
>
> **Expect the application to use approximately 2 GB of RAM even in 2D mode** (increased from approximately 500 MB). Data required by the 3D View is preloaded while using the 2D View so that switching to 3D is significantly faster. The 2D View does not require 8 GB of free RAM, but its normal memory usage now includes this preload.

## Screenshots

### Welcome screen

Start from a focused welcome screen and select a CS2 `.dem` replay file.

![CS2 Replay Viewer welcome screen with Load Demo File button](docs/images/First_Screen.png)

### Loaded replay workspace

The full replay workspace combines the interactive radar, event timeline, section toolbar, team rosters, color-coded round history, and playback controls.

![Loaded CS2 replay overview with radar, toolbar, teams, rounds, timeline, and playback controls](docs/images/Demo_Loaded_Screen.png)

### Side panels and section shortcuts

Open only the controls you need. Section shortcuts can be left unassigned or displayed directly on the toolbar and panel header after assignment.

| Without a section shortcut | With a section shortcut |
|---|---|
| ![Player side panel without an assigned section shortcut](docs/images/Side_Panel_without_Shortcut.png) | ![Sight side panel with an assigned section shortcut](docs/images/Side_Panel_with_Shortcut.png) |

### Color-coded teams and roster shortcuts

CT and T players remain color-coded and alphabetically sorted. Shortcuts belong to roster positions, while unassigned positions show an add button.

![Color-coded CT and T rosters with assigned and unassigned player shortcuts](docs/images/Color_Coded_Teams_with_and_without_shortcuts.png)

### Player focus and utility timing

Highlight and follow a selected player while inspecting sight lines, equipment, active utility, and effect countdowns.

![Highlighted player with sight lines, equipment, utility effects, and countdowns](docs/images/Highlight_a_Player.png)

### Bomb plant and defuse timers

Track the remaining bomb timer and an active defuse directly above the radar while reviewing the surrounding positions.

![Planted bomb countdown and active defuse timer on the replay radar](docs/images/Bomb_Planted_and_Defused_Timer.png)

### Dropped equipment and dead-player markers

See dropped weapons and utility alongside living-player equipment, reload status, and team-colored dead-player icons.

![Dropped weapons, utility, reload status, and dead-player icons on the radar](docs/images/Dropped_Weapon_and_Utility_and_Dead_Player_Icons.png)

### Color-coded round history

Review every round at a glance with winner colors and surviving-player counts for both sides.

![Color-coded round list with T and CT survivors](docs/images/Color_Coded_Rounds.png)

### Team score tracking

Keep the current score visible with team names and consistent T/CT color coding.

![Team names and current round score](docs/images/Keep_Track_of_Won_Rounds_per_Team.png)

### Tactical drawing

Draw routes, callouts, positions, and tactical plans directly on the replay radar.

![Tactical routes, arrows, and callouts drawn on the replay radar](docs/images/Draw_tactics.png)

## Features

### Welcome and project support

- Use all core replay features without an internet connection after installing the application. Three.js, fonts, icons, the demo parser, and the map extractor are packaged with the app; 3D maps are extracted from the selected local CS2 installation. Opening the optional PayPal donation page still requires internet access.
- See the Cherry application logo on installed Windows shortcuts as well as the taskbar and setup executable.
- Read the current version's release notes in a scrollable Welcome-screen dialog shown once per version, and reopen them at any time with `Release Notes...`.
- Open the PayPal donation page directly from the Welcome screen to support continued development.

### Replay navigation

- Load Counter-Strike 2 `.dem` replay demos.
- Play or pause with the on-screen button or the editable <kbd>Space</kbd> shortcut.
- Automatically skip knife rounds and freezetime.
- Browse a timeline for every round.
- View color-coded round results, including the winning side and surviving Terrorists and Counter-Terrorists.
- Keep CT and T player lists consistently sorted by player name in ascending order whenever a replay is loaded.

### 2D and 3D views

- **Mandatory 3D View requirement:** At least **8 GB of free system RAM** must be available before opening the 3D View so the viewer can load and process the map data, geometry, textures, and replay data.
- Expect approximately **2 GB of application RAM usage even in 2D mode**, rather than the previous approximately 500 MB, because data is preloaded to make switching to the 3D View significantly faster.
- Switch between the existing 2D radar and an interactive 3D map without changing the current round, timeline, playback position, or selected player.
- Select the `steamapps\common\Counter-Strike Global Offensive` installation folder once; the validated path is kept in the local settings database for later sessions, and the viewer resolves `game\csgo\maps` itself.
- Extract only the map used by the loaded replay and stream its Source 2 geometry and textures from a versioned local cache. Completed caches are reused in later sessions, while interrupted extractions are never treated as valid.
- Select players from the roster, by shortcut, or directly in the 3D scene to enter their recorded eye view. Pressing any configured free-camera movement key while following a player immediately returns to the free camera.
- Experience recorded flashes in first person using CS2's recorded maximum flash alpha: a full value of 255 keeps the entire 3D view at true 0%-transparency white during its initial fully flashed phase, then fades as the player's vision returns. In free-camera mode, a fading white sheet in front of each flashed player indicates their obstructed vision.
- Read flash strength accurately in 2D from each player's gray flash circle, which uses CS2's recorded maximum flash alpha and fades completely away with the effect.
- Move the free camera with editable, database-backed <kbd>W</kbd>, <kbd>A</kbd>, <kbd>S</kbd>, and <kbd>D</kbd> defaults. Movement speed starts at 36, and movement and mouse-wheel zoom speed remain configurable from the 3D-only Camera panel. Holding the left mouse button hides and locks the pointer inside the 3D view until release for uninterrupted camera look.
- Keep 3D line of sight enabled by default with a starting length of 650 and 50% transparency. Configure its real beam width from 1–50, length up to 1100, and transparency while retaining the full existing Sight panel in 2D mode.
- Follow thrown utility along its recorded per-tick 3D arc and wall/floor bounces, with box-shaped utility shown vertically, without changing the established 2D utility rendering.
- Read each living player's team-colored name and currently selected weapon directly above their 3D health bar, including a `(Reloading)` suffix while a reload is active. A row of SVG icons above the name shows carried utility, C4 possession, and CT defuse-kit possession.
- See ownerless weapons, utility, and C4 at their recorded 3D positions using the matching equipment SVGs and the existing Equipment visibility filters.
- Independently show or hide CT and T noise circles in both replay views with default-on team filters that become available when `Show Noise Circle` is enabled.
- Use the Noise controls in 3D to show flat ground circles at the recorded sound radius—orange for T and blue for CT—for running, shooting, jumping, falling, reloads, and dropped weapons, utility, or C4, with the same source, team, and selected-player filters as 2D. Adjust 3D circle transparency from 0% to 100% in 1% steps, starting at 85%.
- View a 3D smoke effect that is 10% smaller while leaving the established 2D smoke visualization unchanged.
- Mark the planted bomb with a small orange sphere at its planted position; the marker turns gray after a defuse and red after an explosion.
- Read an in-world explosion countdown above the planted bomb, a blue active-defuse countdown beneath it, and clear `Bomb defused` or `Bomb exploded` status text when the bomb reaches a terminal state.
- Fly the free camera directly along the current viewing direction with forward/backward movement, including upward and downward pitch.

### Toolbar and custom shortcuts

- Open Sight, Player, Noise, Timeline, Equipment, Drawing, and Settings controls from a compact icon-and-label toolbar on the left; select an open section again or use the panel's back button to close it. Drawing is available only in the 2D toolbar and is hidden in 3D, while the gear-shaped Settings item is available in both views.
- See each assigned section shortcut as readable bracketed text directly on its toolbar item, with highlighting that always follows the currently open panel.
- Open the PayPal support page directly from the toolbar's Donate item.
- Assign, edit, and remove globally unique keyboard or mouse shortcuts for section headers, checkboxes, supported buttons, playback actions, map variants, and individual roster players. Replay-speed preset buttons remain direct click controls without shortcuts.
- Give every slider an independent decrease and increase shortcut. Press once for one step or hold the shortcut to repeat at the keyboard repeat rate; values remain within their ranges. Holding non-slider shortcuts still triggers them only once.
- Use shortcuts while their control panel is closed. Player shortcuts belong to sorted CT/T roster positions rather than Steam IDs, so they stay on the same visible slot when teams switch sides and trigger the current occupant.
- Click an assigned shortcut keycap to edit it directly; use the adjacent remove icon to clear it.
- Keep shortcut assignments across sessions in the application's local database, with existing mouse-wheel zoom inputs protected from reassignment.
- Keep every configurable checkbox, slider, filter, camera binding, and drawing color/mode in the local settings database across application restarts. Changes save automatically without a Save button; rapidly changing controls use a short trailing debounce so only the latest value is written.
- Export all settings and shortcuts to a chosen JSON file, then import everything, only shortcuts, or only value settings through the Settings panel.
- Restore the application to its first-install defaults from the Settings panel after confirming the red-tinted reset action; this resets saved values and shortcut assignments.
- Press <kbd>Escape</kbd> while adding or editing any shortcut to cancel and preserve the previous assignment.

### Timeline and event review

- Configure timeline visibility with timeline controls.
- Show highlighted, color-coded kill, death/headshot, utility, bomb-plant, bomb-explosion, defuse, and time-expiry SVG icons underneath a timeline that packs non-overlapping events into shared lanes and grows only when stacking is necessary.
- Click an event marker to seek to two seconds before the event.
- Double-click an event marker to copy a CS2 `demo_goto` command for two seconds before that event, ready to paste into the CS2 demo viewer.
- Use the clickable kill feed—with weapon, headshot, flash-assist, blinded-killer, airborne, no-scope, through-smoke, and wallbang SVG indicators and up to ten recent entries—to jump to kills quickly. Flash assists also identify the assisting player.
- Clearly highlight player-roster and round-navigation buttons when hovering or using keyboard focus.
- Click a smoke or fire effect on the map to copy its `demo_goto` command, or double-click it to select the thrower and seek to two seconds before the throw.
- Interact with compact, 50%-transparent Flashbang, HE grenade, and Decoy destination icons using single-click copy and double-click seek behavior.

### Tactical information

- Adjust responsive player sight-cone and line-of-sight overlays without redrawing the full player layer. The 2D Sight panel includes a 0–100% Sight Cone Transparency slider in 1% steps, defaulting to the previous 84% appearance.
- Show responsive, independently filterable noise circles for running, shooting, jumping, falling, weapon drops, utility drops, C4 drops, and weapon reloads. Drop circles appear at the item's destination after it lands, including when the demo event omits weapon details.
- Review grenade and utility activity directly on the map, including smoke/fire center icons and countdowns; Molotovs and incendiaries are hard-capped at 7 seconds and disappear sooner at their actual smoke-extinguished expiry time. Utility is scoped to the round in which it was thrown and never carries into the next round.
- Read the remaining whole seconds before explosion directly in the 2D planted-bomb marker, such as `Bomb 34s`.
- Track living-player health accurately; dead CT players use a blue death icon, dead T players use an orange death icon, and neither shows a health bar.
- See each living player's currently selected weapon or utility name, including a `(Reloading)` status for the full reload lifecycle, plus all remaining utility and carried C4 as stable icons above their name, including both carried Flashbangs when applicable. CT players with a defuse kit show the `defuser.svg` icon in both 2D and 3D. Default-on Player-panel checkboxes independently control utility, C4, and defuse-kit indicators.
- Show exact parser-reported dropped weapon, utility, and ownerless C4 icons alongside death/pickup-tracked defuse-kit icons in both replay views through the current round's seven-second post-round window, with separate visibility checkboxes enabled by default and automatic clearing when another round is selected. Dropped weapon icons are 10% larger in 3D.

### Map interaction and drawing

- Zoom toward the current mouse position with the mouse wheel.
- While following a selected player, use the mouse wheel to adjust the Player Selection zoom value while keeping that player centered.
- Hold the left mouse button and drag to move the map at every zoom level, with generous movement beyond each edge; clicking or dragging empty canvas space exits player follow mode.
- Select a living player dot or roster name to automatically zoom and center the player at the configured zoom level. Selection clears automatically when that player dies.
- Single-click a dead-player icon to copy `demo_goto <Tick>` for three seconds before death, or double-click it to select the player and jump to that tick.
- Create tactical drawings by holding the editable keyboard-only Drawing Setup shortcut—<kbd>Shift</kbd> by default—and dragging with either mouse button. Primary and secondary colors default to CT blue and T orange.
- Keep drawings permanently for the current round or fade them over 1–6 seconds. Changing rounds and `Clear all Drawings` both remove permanent drawings.
- Keep the radar at a consistent visual size when maximizing or restoring the application while zoomed.
- Load and paint the radar background before player dots and other replay overlays appear, without flashing the coordinate grid during normal loading.
- Suppress the embedded WebView context menu so right-click interactions never open browser controls over either replay view.

## Libraries and tools

- [demoinfocs-golang](https://github.com/markus-wa/demoinfocs-golang) — parses CS2 `.dem` files and provides the game events, player frames, grenade data, and round data used by the viewer.
- [Protocol Buffers](https://github.com/protocolbuffers/protobuf) — serializes the parsed replay data efficiently between the Go parser and the application.
- [protobuf-es](https://github.com/bufbuild/protobuf-es) — reads the protobuf replay data in the TypeScript frontend.
- [Tauri](https://github.com/tauri-apps/tauri) — provides the lightweight desktop application shell and native file, shell, and dialog integration.
- [Svelte](https://github.com/sveltejs/svelte) and [SvelteKit](https://github.com/sveltejs/kit) — power the interactive TypeScript user interface.
- [Vite](https://github.com/vitejs/vite) — builds and bundles the frontend.
- [Three.js](https://threejs.org/) — renders the interactive 3D replay scene, players, utility, and extracted map geometry.
- [ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat) — extracts local CS2 map resources into the cached glTF data used by the 3D view. The pinned Windows CLI and its native runtime files are provisioned automatically during Tauri development and release builds, then bundled into the installer; end users do not install or download it separately.
- [cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons) — supplies the radar images and overview metadata used to place replay data accurately on each supported map.
- [counter-strike-icons](https://github.com/Juknum/counter-strike-icons/tree/main/cs2/panorama/images/icons/equipment) — supplies the CS2 equipment SVGs used by the kill feed, timeline markers, and utility effect centers from `static/equipment-icons`. The empty `world.svg` and `worldent.svg` source files are intentionally excluded.

## Supported maps

- de_ancient
- de_anubis
- de_cache
- de_dust2
- de_inferno
- de_mirage
- de_nuke
- de_overpass
- de_train
- de_vertigo

## License

This project is open source. See [LICENSE](LICENSE) for details.

## Donations

If you enjoy CS2 Replay Viewer and would like to support its development, you can donate via PayPal.

<a href="https://paypal.me/cliption">
  <img src="https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate with PayPal" />
</a>
