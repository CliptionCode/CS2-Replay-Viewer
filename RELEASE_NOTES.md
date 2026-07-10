# CS2 Replay Viewer v0.1.4

Version 0.1.4 improves tactical map interaction, player-focused replay analysis, utility visibility, and rendering performance. It also fixes smoke lifetimes so every deployed smoke receives its own complete 18-second duration.

## Change Overview

- 🚀 **New:** Newly added features or capabilities
- 🔧 **Adjusted:** Existing behavior, visuals, or defaults that changed
- 🗑️ **Removed:** Controls or workflows that are no longer present
- ⚡ **Performance:** Responsiveness and rendering improvements
- 🐛 **Fixed:** Incorrect or unreliable behavior that was corrected

## 🚀 New Features

### Automatic Player Focus

- Selecting a player now automatically zooms to and centers that player using the configured player zoom level.
- Player focus works when clicking a player dot, roster name, kill-feed entry, or player-backed timeline marker.
- The player zoom slider remains available in the **Player Selection** section.

### Utility Effect Icons and Countdowns

- Active smoke effects now display the `map_smoke.svg` icon in their center.
- Active Molotov and incendiary effects now display the `inferno.svg` icon in their center.
- Smoke, Molotov, and incendiary effects now display their remaining duration directly over the icon.
- Smoke countdown text is light green; Molotov/incendiary countdown text is gray. Both use a dark outline for readability.

### Shift-Held Tactical Drawing

- Hold <kbd>Shift</kbd> and drag with the left mouse button to draw freely on the radar.
- Releasing <kbd>Shift</kbd> immediately returns the mouse to normal player selection and map-panning behavior.
- Drawing color, stroke-width, and clear-all controls remain available.

## 🔧 Adjusted Features

### Sight and Line-of-Sight Defaults

- Sight-cone width now defaults to `0.68`.
- Sight-cone length now defaults to `75`.
- Line-of-sight width now defaults to `1.6`.
- Line-of-sight length now defaults to `300`.
- **LOS Width** is now displayed before **LOS Len**, matching the sight-cone control order.

### Utility Effect Appearance

- The smoke effect icon is now `56px`, twice its original 28px size.
- The Molotov/incendiary effect icon is now approximately 50% larger at `42px`.
- The Molotov/incendiary effect icon is rendered at 50% opacity so the radar underneath remains visible.

### Flash Indicators

- Flash-indicator opacity now accounts for both flash strength and remaining duration.
- Minimally flashed players receive a much more transparent indicator.
- Strong flashes remain clearly visible and fade naturally over their duration.

## 🗑️ Removed Controls

- Removed the **Zoom Selected Player** checkbox. Player focusing now happens automatically when a player is selected.
- Removed the **Start Drawing / Stop Drawing** toggle. Drawing is now activated by holding <kbd>Shift</kbd>.

## ⚡ Performance Improvements

- Sight-cone and line-of-sight geometry now render on a dedicated lightweight canvas.
- Dragging sight-cone or line-of-sight sliders no longer redraws the full player layer.
- Adjusting sight width, sight length, LOS width, and LOS length is now substantially more responsive.

## 🐛 Bug Fixes

### Independent 18-Second Smoke Lifetimes

- Every smoke now lasts exactly 18 seconds (`1,152` replay ticks) from its own detonation.
- Smoke expiry events can no longer overwrite or shorten the lifetime of another smoke.
- Multiple smokes thrown by the same player are tracked independently, including smokes acquired through weapon drops.
- The frontend independently enforces the full 18-second smoke lifetime, protecting countdowns from older parsed data containing an incorrect early fade tick.
- Smoke trajectory matching now pairs destruction records with the lifecycle that began approximately 18 seconds earlier instead of an unrelated newer smoke.
- The bundled demo-parser sidecar was rebuilt with the corrected smoke-lifetime behavior.

### Player Focus and Health

- Fixed selected-player centering after previously zooming or panning with the mouse. Old mouse transforms are reset before player focus is applied.
- Dead players now correctly display an empty health bar at `0 HP` instead of appearing to have full health.

## 📦 Version and Documentation

- Updated the application version from `0.1.3` to `0.1.4` across the frontend and Tauri manifests.
- Added regression coverage for independent smoke-duration calculations.
- Updated the project documentation to reflect the new controls, defaults, utility visuals, performance improvements, and smoke behavior.
