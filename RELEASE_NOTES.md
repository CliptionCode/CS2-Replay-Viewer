# CS2 Replay Viewer v0.2.0

Version 0.2.0 introduces an integrated 3D replay view while preserving the familiar 2D radar, shared timeline, playback controls, round navigation, roster, and player shortcuts.

## Change Overview

- 🚀 **New Features:** Interactive 3D map replays, player-eye viewing, free-camera controls, and planted-bomb state markers
- 🔧 **Adjusted Features:** Expanded 3D line-of-sight controls, database-backed movement defaults, and automatic map-cache reuse
- ⚡ **Performance Improvements:** Map-specific extraction, bounded map streaming, and persistent completed caches
- 🐛 **Bug Fixes:** Stable 3D loading lifecycle, accurate per-tick utility arcs and bounces, functional line-of-sight width, incomplete-cache detection, and suppressed WebView context menus
- 📦 **Version and Documentation:** Version 0.2.0, bundled 3D map component, and updated feature guide

## 🚀 New Features

### Integrated 3D Replay View

- Switch between the existing 2D radar and a fully interactive 3D map from the bottom controls.
- Keep the current timeline, round, playback position, team roster, and player selection when changing views.
- Select a player through the roster, an assigned player shortcut, or their model in the 3D scene to enter the recorded player-eye view.
- View recorded player positions, health, utility trajectories, and map geometry using locally installed Counter-Strike 2 data.

### Camera Controls

- Use W, A, S, and D as editable free-camera movement keys.
- Keep camera key assignments in the local settings database from the first application startup.
- Configure camera movement speed, starting at 36, and mouse-wheel zoom speed from the 3D-only Camera panel.
- Move forward and backward along the full viewing direction, including climbing or descending when looking up or down.

### Bomb State Marker

- See a small orange sphere at the planted bomb position.
- See the remaining explosion time above the bomb and a kit-aware blue countdown while a Counter-Terrorist is actively defusing.
- See the marker turn gray when the bomb is defused.
- See the marker turn red when the bomb explodes.
- See clear blue or red status text above the marker after a defuse or explosion.

## 🔧 Adjusted Features

### 3D Line of Sight

- Show 3D line of sight by default.
- Start with a line-of-sight length of 500 and increase it up to 1100.
- Adjust real beam width from 1 to 50 in whole-number steps.
- Adjust beam transparency independently from width and length.
- Keep the existing 2D Sight controls and values unchanged.

### Counter-Strike 2 Game Data

- Select the `steamapps\common\Counter-Strike Global Offensive` folder; the application resolves the required map files itself.
- Extract only the map used by the loaded replay.
- Reuse completed map caches in later sessions without processing the VPK again.
- Include the pinned Source 2 map component and all native dependencies in the Windows installer, with no end-user setup or download step.

## ⚡ Performance Improvements

- Stream large map resources through bounded local slices instead of loading one enormous map buffer through the desktop asset protocol.
- Version caches from the installed map VPK so changed game files produce a fresh map cache automatically.
- Mark successful extractions as complete so cached maps can be loaded immediately and reliably.

## 🐛 Bug Fixes

- Prevented reactive loading-state changes from repeatedly recreating the Three.js scene and restarting the loading spinner.
- Preserved an existing player selection when switching from 2D to 3D so the loaded map opens directly in that player's first-person view.
- Replaced the planted-bomb countdown cleanly with a large blue `Bomb defused` message instead of stretching the previous countdown texture.
- Oriented rectangular 3D utility models vertically instead of displaying them horizontally.
- Replaced unsupported WebGL line-width behavior with real 3D beam geometry so the width slider visibly changes line of sight.
- Prevented interrupted map extractions from being mistaken for complete caches.
- Disabled the embedded WebView context menu so right-clicking no longer opens browser controls.

## 📦 Version and Documentation

- Increased the application version from `0.1.12` to `0.2.0` across package, desktop-shell, and Rust metadata.
- Updated the feature guide and implementation context for the complete 3D workflow.
