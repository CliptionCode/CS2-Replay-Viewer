# CS2 Replay Viewer v0.1.11

Version 0.1.11 makes active reloads visible at a glance and introduces a distinctive cherry-logo application identity.

## Change Overview

- 🚀 **New Features:** Live reload status beside equipped weapons
- 🔧 **Adjusted Features:** Faster replay presentation and new application/browser icons
- 📦 **Version and Documentation:** Release and feature guide updates

## 🚀 New Features

### Live Reload Status

- A living player's equipped weapon now shows `(Reloading)` from the moment the reload starts.
- The status remains visible until the reload finishes or is cancelled or aborted.

## 🔧 Adjusted Features

### Replay Loading

- The radar background now finishes loading and visibly paints before player dots, equipment, utility, kill markers, and drawings appear.
- The coordinate grid no longer flashes while a normal radar image is loading; a lightweight loading surface is shown instead.
- Radar image loading is prioritized so the replay becomes visually ready sooner.

### Application Identity

- Replaced the blue default application icon with the new two-cherry logo.
- The same artwork now appears as the browser favicon.

## 📦 Version and Documentation

- Increased the application version from `0.1.10` to `0.1.11`.
- Updated the feature guide and implementation context for reload status and application branding.
