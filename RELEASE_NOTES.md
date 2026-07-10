# CS2 Replay Viewer v0.1.5

Version 0.1.5 makes replays smoother to explore and adds more detail to the kill feed. It also improves how Molotovs, incendiary grenades, smoke extinguishing, player selection, and map dragging behave.

## Change Overview

- 🚀 **New:** Newly added features
- 🔧 **Adjusted:** Improvements to existing behavior
- ⚡ **Performance:** Smoother and more responsive interactions
- 🐛 **Fixed:** Corrected behavior

## 🚀 New Features

### More Detailed Kill Feed

- The kill feed can now indicate when the killer was blind or flashed.
- Flash-assisted kills show the assisting player's name.
- New indicators identify airborne, no-scope, through-smoke, and wallbang kills.
- Weapon and headshot indicators remain available as before.

### Smoke Can Extinguish Fire

- Smoke grenades now extinguish active Molotov and incendiary fire.
- A Molotov or incendiary landing in an existing smoke can be extinguished immediately.
- The fire effect and countdown disappear as soon as the fire is extinguished.

## 🔧 Adjusted Features

### Player Deselection

- Clicking an already selected player now only deselects that player and stops the camera from following them.
- The current zoom level and map position remain unchanged after deselection.
- You can continue panning or zooming from the same view.

### Easier Map Dragging

- Match scores, bomb messages, round-win messages, and copy confirmations can no longer be accidentally selected as text.
- Dragging across these messages no longer interferes with moving around the map.

## ⚡ Performance Improvements

### Smoother Player Selection

- Selecting a player while the replay is playing is now much more responsive.
- The camera switches to the selected player without the previous pause or canvas freeze.
- Switching repeatedly between players is smoother.

## 🐛 Bug Fixes

### Correct Fire Duration

- Molotov and incendiary fire can never burn for longer than 7 seconds.
- Fire extinguished by smoke ends sooner, at the correct moment.
- Fixed cases where fire could remain visible with incorrect countdowns such as 12 or 20 seconds.
- Fixed fire sometimes receiving an additional lifetime after it had already ended.

### Kill Feed Details

- Fixed special kill conditions and flash-assist information not appearing in the kill feed.

### Copy Confirmation

- The `Copied demo_goto <tick>` confirmation no longer interferes with mouse dragging.

## 📦 Version and Documentation

- Updated CS2 Replay Viewer from version `0.1.4` to `0.1.5`.
- Updated the included documentation to describe the new and adjusted behavior.
