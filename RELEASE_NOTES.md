# CS2 Replay Viewer v0.1.6

Version 0.1.6 is mostly meant as a Hotfix. It adds a Donation Button to the Welcome screen and restores dependable map navigation after leaving player focus mode.

## Change Overview

- 🚀 **New:** Newly added features
- 🔧 **Adjusted:** Improvements to existing behavior
- 🐛 **Fixed:** Corrected behavior
- 📦 **Version and Documentation:** Release and guide updates

## 🚀 New Features

### Donate from the Welcome Screen

- A new `Donate with PayPal` button is available before a replay is loaded.
- The button opens the project's PayPal donation page in your default browser.

## 🔧 Adjusted Features

### Replay Viewport Input

- Mouse-wheel zoom and mouse-drag panning now stay scoped to the replay map.
- Browser page scrolling no longer competes with zooming over the replay canvas.

## 🐛 Bug Fixes

### Map Dragging After Player Deselection

- Fixed mouse dragging becoming unavailable after selecting and then deselecting a player.
- The retained zoom and map position can now be adjusted immediately after camera follow is stopped.
- Removed the browser warning that appeared while zooming the replay map.

## 📦 Version and Documentation

- Updated CS2 Replay Viewer from version `0.1.5` to `0.1.6`.
- Updated the included feature documentation and project context for the new Welcome-screen control and repaired map navigation.
