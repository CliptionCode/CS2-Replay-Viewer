# CS2 Replay Viewer v0.2.2

Version 0.2.2 brings flash visibility and noise visualization into the 3D replay view, making it easier to understand what players could see and hear at each moment.

## Change Overview

- 🚀 **New Features:** Fading first-person flash effects, free-camera flash indicators, and 3D noise circles
- 🔧 **Adjusted Features:** Existing Noise controls now work consistently in both 2D and 3D
- 📦 **Version and Documentation:** Version 0.2.2 and updated feature documentation

## 🚀 New Features

### 3D Flash Visibility

- A fully flashed player's first-person view is completely covered in white.
- The white effect fades smoothly as the player's recorded vision returns.
- Free-camera mode shows a thin white sheet in front of every flashed player.
- Each free-camera flash sheet fades with that player's remaining flash effect.

### 3D Noise Circles

- Show noise in 3D as flat ground circles with the recorded sound radius.
- Identify the noise source's recorded side immediately: Terrorist circles are orange and Counter-Terrorist circles are blue.
- Adjust 3D noise-circle transparency from 0% to 100% in 1% steps with a new slider under Noise visibility; it starts at 85% transparency.
- See noise from running, shooting, jumping, falling, and weapon reloads.
- See noise where dropped weapons, utility, and C4 finish landing.
- Moving noise sources follow the player when appropriate, while jumps, falls, and item drops remain at their recorded positions.

## 🔧 Adjusted Features

### Shared Noise Controls

- `Show Noise Circle` now enables noise visualization in both replay views.
- Use the new default-on `Show CT Circle` and `Show T Circle` checkboxes to hide either team's noise in both 2D and 3D; these controls are available only while the master noise toggle is enabled.
- Source filters control the matching 2D and 3D circles.
- `Noise for Selected Player` applies to both views.

## 📦 Version and Documentation

- Increased the application version from `0.2.1` to `0.2.2`.
- Updated the feature guide and implementation context for the new 3D flash and noise behavior.
