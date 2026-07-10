# CS2 Replay Viewer v0.1.8

Version 0.1.8 expands tactical review with interactive grenade destinations, flexible drawing tools, clearer death review, and more freedom when navigating the radar.

## Change Overview

- 🚀 **New:** Newly added features
- 🔧 **Adjusted:** Improvements to existing behavior
- 🗑️ **Removed:** Controls or features no longer shown
- 🐛 **Fixed:** Corrected behavior
- 📦 **Version and Documentation:** Release and guide updates

## 🚀 New Features

### Interactive Grenades on the Map

- Smoke and fire effect areas can now be clicked to copy a two-second lead-in `demo_goto` command.
- Double-clicking a smoke or fire area selects its thrower and seeks to two seconds before the throw.
- Flashbang, HE grenade, and Decoy destinations now show color-coded equipment icons for five seconds after landing.
- Destination equipment icons use a compact size, begin at 50% opacity, and gradually fade away.
- Single-clicking a destination icon copies the throw's lead-in command, while double-clicking selects the thrower and seeks to the throw.

### Dual-Color and Fading Drawings

- Shift-drag with the left mouse button to draw in CT blue by default.
- Shift-drag with the right mouse button to draw in T orange by default.
- Both mouse colors can be customized independently.
- Choose `Permanent` for round-long drawings or `Fade` for strokes that disappear gradually over 1–6 seconds.

## 🔧 Adjusted Features

### Player-Focused Navigation

- Scrolling while a player is selected adjusts the visible Player Selection zoom value and keeps the player centered.
- Clicking empty map space or beginning a left-button drag stops following the selected player while preserving the current view.
- Mouse-position zoom remains available when no player is selected.
- Player selection now ends automatically when the selected player dies.

### More Flexible Map Movement

- The radar can now be dragged even at the fully zoomed-out view.
- Pan limits provide substantially more room to position the radar toward any edge at both low and high zoom levels.

### Dead Players

- Dead players use a death icon instead of a player dot and no longer show a health bar.
- Dead Counter-Terrorists use blue death icons, while dead Terrorists use orange death icons.
- Single-clicking a dead-player icon copies a `demo_goto` command for three seconds before the death.
- Double-clicking a dead-player icon selects that player and jumps directly to the same three-second lead-in.

### Round Drawings

- Changing rounds clears all drawings automatically.
- Permanent drawings otherwise remain until `Clear all Drawings` is used.

## 🗑️ Removed Controls/Features

### Dropped Equipment Controls

- Removed the `Dropped Equipment` settings section and its weapon and utility checkboxes.
- The viewer no longer creates estimated death drops or positions from player data; only exact dropped-item positions supplied by a replay can be rendered.

## 🐛 Bug Fixes

### Stable Map Size When Maximizing

- The radar no longer becomes extremely small when maximizing the application while zoomed.
- Maximizing and restoring the application now preserve a consistent radar size.

## 📦 Version and Documentation

- Updated CS2 Replay Viewer directly from version `0.1.6` to `0.1.8`; version `0.1.7` was not released separately.
- Updated the feature guide and project context for all new controls and interactions included in this combined release.
