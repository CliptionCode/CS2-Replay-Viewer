# CS2 Replay Viewer v0.2.1

Version 0.2.1 makes the 3D replay view easier to read by adding player and equipment labels, refining the default line-of-sight display, and slightly reducing smoke size. It also adds defuse-kit indicators for living Counter-Terrorists in both replay views.

## Change Overview

- 🚀 **New Features:** Player-name, active-weapon, carried-equipment, and dropped-equipment indicators in 3D, plus configurable defuse-kit indicators in both views
- 🔧 **Adjusted Features:** Player-equipment visibility controls, dropped-equipment filters, larger 3D weapon icons, a streamlined 3D toolbar, longer 3D line of sight, and a smaller 3D smoke effect
- 📦 **Version and Documentation:** Version 0.2.1 and updated feature documentation

## 🚀 New Features

### 3D Player Labels

- See each living player's name above their health bar in orange for Terrorists and blue for Counter-Terrorists.
- See the player's currently selected weapon or utility between their name and health bar.
- See `(Reloading)` beside the weapon name for the full recorded reload duration.
- See every carried utility as an equipment icon above the player name, including both Flashbangs when carried.
- See a C4 icon in the same row to identify the current bomb carrier.

### Defuse-Kit Indicators

- See `defuser.svg` beside a living Counter-Terrorist's utility in both 2D and 3D.
- See a dropped defuse kit at its carrier's recorded position after death, and see it disappear when another player picks it up.
- Toggle dropped defuse kits independently from weapons, utility, and C4 in the Equipment panel.
- Reparse older demos to populate the new defuse-kit indicator throughout the replay.

### Player Equipment Controls

- Independently show or hide player utility, C4 possession, and defuse-kit possession from the Player panel.
- Start with all three visibility controls enabled in both replay views.

### Dropped Equipment in 3D

- See ownerless weapons, utility, and C4 at their recorded positions using the matching equipment icons.
- Use the existing Weapons, Utility, and C4 checkboxes to control their visibility.
- Keep items scoped to the active round so equipment from a previous round does not remain in the scene.

## 🔧 Adjusted Features

### 3D Line of Sight

- Increased the default line-of-sight length from 500 to 650.
- Changed the default transparency from 70% to 50%.
- Kept all 2D line-of-sight settings unchanged.

### 3D Smoke Size

- Reduced the 3D smoke effect radius by 10% for a less oversized appearance.
- Kept the 2D smoke visualization unchanged.

### 3D Presentation

- Increased dropped weapon icon size by 10% without changing other dropped-equipment sizes.
- Removed the Drawing toolbar item from the 3D view while keeping drawing available in 2D.
- Made 2D Player Equipment checkbox changes redraw only the inventory overlay, avoiding the previous full-canvas pause.

## 📦 Version and Documentation

- Increased the application version from `0.2.0` to `0.2.1`.
- Updated the feature guide and implementation context for the new 3D behavior.
