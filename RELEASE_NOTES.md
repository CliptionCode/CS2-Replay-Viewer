# CS2 Replay Viewer v0.1.9

Version 0.1.9 makes player loadouts and audible actions easier to review by adding live utility icons, dropped C4 tracking, and new noise-circle filters.

## Change Overview

- 🚀 **New:** Newly added features
- 🔧 **Adjusted:** Improvements to existing behavior
- 🐛 **Fixed:** Corrected behavior
- 📦 **Version and Documentation:** Release and guide updates

## 🚀 New Features

### Drop and Reload Noise

- Weapon, utility, and C4 drops can now display noise circles.
- Weapon reloads can now display noise circles.
- Each new noise source has its own checkbox and is enabled by default.
- New source filters only display circles while the master `Show Noise Circle` checkbox is enabled.

### Dropped C4

- Ownerless C4 now appears at its exact ground position with the C4 icon.
- The C4 marker disappears when it is picked up or planted and does not remain after explosion or defuse.
- A new `Dropped C4` checkbox is enabled by default in the `Dropped Equipment` section.

### Live Player Equipment

- Living players continue to show the name of their currently selected weapon or utility.
- Every remaining grenade is shown above the player's name with a white utility icon.
- The C4 icon appears in the same inventory row while a living player is carrying the bomb.
- Players carrying two Flashbangs display two Flashbang icons, and throwing one removes only one icon.

## 🔧 Adjusted Features

### Noise Controls

- Corrected the master control label from `Show Noice Circle` to `Show Noise Circle`.
- Existing running, jumping, shooting, and falling filters continue to work independently alongside the new sources.

### Dropped Equipment

- Dropped-equipment visibility now covers weapons, utility, and C4 with a separate default-enabled filter for each category.

## 🐛 Bug Fixes

### Stable Utility Inventory

- Multiple carried utility icons now keep a consistent left-to-right order instead of repeatedly swapping positions.
- Utility slots remain fixed while icon images load, preventing the row from shifting or re-centering.

## 📦 Version and Documentation

- Increased the application version from `0.1.8` to `0.1.9`.
- Updated the feature guide and project context for the new noise, equipment, and player-inventory behavior.
