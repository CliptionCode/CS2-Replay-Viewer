# CS2 Replay Viewer v0.2.4

Version 0.2.4 adds complete settings persistence and transfer, improves 3D camera control, and fixes round-to-round utility visibility while making important 2D information easier to read.

## Change Overview

- 🚀 **New Features:** Persistent settings, selective settings import/export, in-app release notes, and adjustable 2D sight-cone transparency
- 🔧 **Adjusted Features:** Locked 3D mouse look, movement-key return to free camera, and a 2D bomb explosion countdown
- 🐛 **Bug Fixes:** Utility no longer carries into the next round, and installed Windows shortcuts use the Cherry icon
- 📦 **Version and Documentation:** Version 0.2.4 with refreshed feature and implementation documentation

## 🚀 New Features

### Persistent Viewer Settings

- Every configurable checkbox, slider, utility filter, equipment option, camera binding, drawing color, and drawing mode is now kept in the local database.
- Saved settings are restored automatically when the application starts again.
- Changes save automatically without a Save button, with rapidly changing controls debounced so the database receives the latest value.

### Settings Import and Export

- A new gear-shaped Settings toolbar item is available in both 2D and 3D.
- Export all preferences and shortcuts to a JSON file at a location you choose.
- Import everything, only shortcuts, or only value settings through a clear confirmation dialog.
- Cancelling the import leaves the current setup unchanged.
- Restore every saved value and shortcut assignment to the application's first-install defaults through a separately confirmed, red-tinted Settings action.
- Import choices are color-coded for quicker recognition: green for everything, orange for shortcuts, and blue for settings.

### In-App Release Notes

- The Welcome screen now presents the current version's release notes automatically once per application version.
- Close the scrollable dialog with its X button; it stays dismissed through later restarts for the same version.
- Use the new `Release Notes...` button on the Welcome screen to open the notes again at any time.

### 2D Sight Cone Transparency

- The 2D Sight panel now includes a Sight Cone Transparency slider from 0% to 100% in 1% steps.
- Its 84% default matches the previous appearance.
- Like other sliders, it supports optional decrease and increase shortcuts.

## 🔧 Adjusted Features

### 3D Mouse Look

- Holding the left mouse button now hides the cursor and locks mouse movement inside the 3D view.
- Releasing the button restores the cursor and releases the mouse immediately.

### Welcome Screen Layout

- The donation action now sits farther below the primary Welcome-screen actions for a cleaner visual hierarchy.
- The application version is displayed at the bottom center of the Welcome screen.

### Faster Return to the Free Camera

- Pressing any configured camera movement key while following a player now deselects that player automatically.
- The same key press begins free-camera movement without requiring a separate deselect action.

### 2D Bomb Countdown

- A planted bomb's 2D marker now includes the remaining whole seconds before explosion, such as `Bomb 34s`.
- The marker disappears after a recorded defuse or explosion.

## 🐛 Bug Fixes

### Round-Scoped Utility

- Smokes and other utility thrown in one round no longer remain visible after the next round begins.
- Projectile trails, active effects, countdowns, and destination markers all follow the round in which the utility originated.

### Settings File Transfer

- Fixed the filesystem capability mismatch that prevented exported JSON settings files from being written after choosing a destination.
- Import now uses the matching text-file permission, and transfer failures show a clear, non-technical recovery message in the application.

### Windows Cherry Branding

- The packaged application executable embeds the Cherry icon, so shortcuts created for the installed application display the Cherry logo instead of the old blue icon.
- The Windows setup and uninstaller executables also explicitly use the same Cherry icon instead of the default blue installer icon.

## 📦 Version and Documentation

- Increased the application version from `0.2.3` to `0.2.4`.
- Updated the feature guide and implementation context for the new settings workflow, release-notes dialog, camera behavior, and 2D replay improvements.
