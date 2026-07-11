# CS2 Replay Viewer v0.1.12

Version 0.1.12 introduces a compact left-side control toolbar and a persistent custom shortcut system for faster replay review.

## Change Overview

- 🚀 **New Features:** Custom keyboard and mouse shortcuts across replay controls and players
- 🔧 **Adjusted Features:** Section-based left toolbar and expanded player rows
- 📦 **Version and Documentation:** Version 0.1.12 release and feature-guide updates

## 🚀 New Features

### Custom Shortcuts

- Add, edit, or remove shortcuts directly beside supported controls.
- Assign keyboard combinations, mouse buttons, and modified mouse-wheel inputs while keeping every shortcut unique.
- Trigger checkboxes, buttons, section panels, playback actions, map variants, and individual players even when their control panel is closed.
- Use separate decrease and increase shortcuts for sliders; each press follows that slider's configured step, and holding the shortcut repeats the adjustment. Non-slider shortcuts remain single-trigger per press.
- Keep all assignments between application sessions in the local shortcut database.
- See add, edit, and remove changes immediately without reopening a control panel.
- Press Escape during any shortcut capture to cancel while preserving the previous assignment.
- Receive an on-screen notice when an input is already assigned, then continue listening for another input.
- Existing map-wheel zoom inputs are protected from reassignment.

## 🔧 Adjusted Features

### Replay Controls

- Replaced the always-open left control stack with a compact vertical toolbar for Sight, Player, Noise, Timeline, Equipment, and Drawing.
- Each toolbar item now uses a centered icon and label with matching hover and selected highlights.
- Assigned section shortcuts now appear as readable bracketed text directly on their toolbar items, and shortcut-driven panel changes no longer leave an old mouse-selected item highlighted.
- Selecting a section opens only its controls in a slide-out panel; selecting it again or using the panel's back button closes it.
- Added Donate to the toolbar with the same PayPal behavior as the Welcome screen.
- Added shortcut controls beside bottom playback actions and beside every roster player without changing player selection behavior.
- CT and T player lists are now sorted alphabetically by player name for a consistent order every time the same replay is loaded.
- Player shortcuts now stay with their sorted CT/T roster position instead of following a Steam ID, so side switches select the new player occupying that slot.
- Assigned shortcut keycaps are now directly clickable for editing, replacing the separate pencil icon.
- Replay-speed preset buttons remain direct click controls and no longer offer shortcut assignments; previously saved speed shortcuts are cleared automatically.
- Added an editable Drawing Setup hold shortcut with Shift as its default, plus clearer Primary and Secondary drawing-color labels.
- Drawing Setup remains keyboard-only; any mouse-based Drawing Setup assignment is restored to the default Shift binding.
- Centered and restyled shortcut keycaps, and changed empty decrease-slider bindings to a minus icon.
- Color pickers remain shortcut-free so drawing colors stay focused on direct visual input.

## 📦 Version and Documentation

- Increased the application version from `0.1.11` to `0.1.12`.
- Updated the feature guide and implementation context for the toolbar and shortcut system.
