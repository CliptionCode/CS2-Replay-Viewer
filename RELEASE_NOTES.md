# CS2 Replay Viewer v0.1.10

Version 0.1.10 makes noise filtering feel immediate, restores missing drop-noise circles, and presents newly loaded replays in the correct visual order.

## Change Overview

- ⚡ **Performance:** Faster, smoother interactions
- 🐛 **Fixed:** Corrected behavior
- 🔧 **Adjusted:** Improvements to existing behavior
- 📦 **Version and Documentation:** Release and guide updates

## 🔧 Adjusted Features

### Replay Loading

- The radar background now finishes loading before player dots, equipment, utility, kill markers, and drawings appear.
- If a radar image is unavailable, the replay still proceeds with the fallback map background.

### Round-Specific Dropped Equipment

- Dropped weapons, utility, and C4 are now cleared when another round is selected.
- The seven-second post-round display remains limited to the round where the item was dropped.
- Delayed or still-moving item markers from the finished round no longer reappear during the next round.

## ⚡ Performance Improvements

### Responsive Noise Controls

- Checking or unchecking any option in the `Noise` section now updates only the noise display.
- Noise filters no longer pause the full replay interface while unrelated player details and movement trails redraw.
- Long demos remain responsive because only noise events relevant to the current moment are evaluated.

## 🐛 Bug Fixes

### Drop Noise Circles

- Fixed missing noise circles for weapon drops.
- Fixed missing noise circles for utility drops.
- Fixed missing noise circles for C4 drops.
- Drop circles now wait until the item has landed and then appear at its final ground location while remaining associated with the player who dropped it.
- Drop detection now also works when a demo omits the weapon details from its normal drop event.

### Frontend Reliability

- Removed obsolete, unused replay-rendering code that was no longer part of the application.
- Corrected the frontend type-checking setup so project diagnostics can run without missing runtime type definitions or entry-point errors.

## 📦 Version and Documentation

- Increased the application version from `0.1.9` to `0.1.10`.
- Updated the feature guide and replaced the project context with a shorter implementation reference focused on current architecture and workflow rules.
