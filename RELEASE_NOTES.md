# CS2 Replay Viewer v0.2.3

Version 0.2.3 makes the installed replay viewer independent of runtime downloads, so core 2D and 3D replay features remain available without an internet connection.

## Change Overview

- 🚀 **New Features:** Offline use for all core replay-viewing features
- 🔧 **Adjusted Features:** Locally packaged interface fonts and a stronger fully flashed first-person 3D view
- 🐛 **Bug Fixes:** Spacebar playback no longer resets a focused timeline
- 📦 **Version and Documentation:** Version 0.2.3 and updated offline-use documentation

## 🚀 New Features

### Offline Replay Viewing

- Load, parse, and review replay demos without an internet connection.
- Use both the 2D radar and the interactive 3D view offline.
- Keep map extraction local by using the selected CS2 installation and the extractor included with the application.
- Use the packaged replay renderer, fonts, icons, radar images, and other required interface assets without runtime downloads.

## 🔧 Adjusted Features

### Locally Packaged Fonts

- Inter and JetBrains Mono now load directly from the installed application.
- The interface no longer contacts Google Fonts while starting or during replay review.
- Opening the optional PayPal donation page still requires an internet connection.

### Fully Flashed First-Person View

- A fully flashed player's 3D first-person screen now uses CS2's recorded maximum flash opacity and renders at true 0%-transparency white during the initial full-flash phase.
- The white screen still fades smoothly as the recorded flash effect wears off.
- Partial flashes and free-camera flash indicators retain their existing intensity behavior.

### Accurate 2D Flash Strength

- Gray flash circles around players now use CS2's recorded maximum flash opacity instead of estimating strength from duration.
- The 2D flash indicator now fades completely to transparent when the recorded effect ends.

## 🐛 Bug Fixes

### Timeline Spacebar Playback

- Pressing the Play/Pause Spacebar shortcut after clicking the timeline now toggles playback without jumping back to the beginning of the round.

## 📦 Version and Documentation

- Increased the application version from `0.2.2` to `0.2.3`.
- Updated the feature guide and implementation context to describe offline operation and the remaining optional internet action.
