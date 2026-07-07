# CS2 Replay Viewer

A high-performance, desktop-quality Counter-Strike 2 replay viewer built with cutting-edge Go and web technologies.

## Overview

This project provides a sophisticated 2D replay viewer for CS2 demos (.dem files) that renders:

- **Player positions and trails** with team coloring
- **Kill markers** with explosion effects
- **Nade trajectories** (smoke, HE, flash, molotov, decoy)
- **Playback controls** (play/pause, seek, scrub)
- **Round navigation** buttons and timeline
- **Player stats** sidebar with KAST and ADR calculations

## Architecture

### Backend (Go)
- **demoinfocs-golang** v5: Fast, production-ready CS2 demo parser
- **Protobuf serialization**: Efficient binary data transfer between Go and frontend
- **Error handling**: Comprehensive error detection and user-friendly messages
- **Performance**: 60 FPS rendering with Canvas 2D

### Frontend (SvelteKit + Tauri v2)
- **Three-layered Canvas architecture** for optimal performance
- **MapLayer**: Static radar backgrounds (PNG + coordinate data)
- **PlayerLayer**: Dynamic player dots, trails, and team indicators
- **NadeLayer**: Grenade trajectories and effect zones
- **KillLayer**: Death markers and real-time kill feed

## Key Features

### 🚀 Performance
- **60 FPS rendering** with Canvas 2D
- **Ultra-fast parsing** < 1s for 40-minute demos
- **Memory-efficient** binary protobuf format (<150MB)
- **Layered rendering** only redraws dirty regions

### 🎮 Intuitive UI
- **Timeline scrubber** for instant navigation
- **Round navigation** grid with kill counts
- **Kill feed overlay** with headshot/wallbang indicators
- **Player stats sidebar** with KAST calculations

### 🗾 Reliability
- **Error boundaries** with user-friendly messages
- **Retry mechanisms** for failed file operations
- **Graceful fallbacks** for corrupted demos
- **Memory management** for large files

## Quick Start

### Prerequisites
- Go 1.26.4+
- Rust 1.80+
- Node.js 20+
- pnpm 9+

### Installation

```bash
# Clone the repository
git clone https://github.com/yourname/cs2-replay-viewer
cd cs2-replay-viewer

# Install dependencies
pnpm install

# Build and run
pnpm tauri dev
```

### Running Tests

```bash
# Test the parser backend
cd backend
./cs2-parser.exe  # Run the sidecar binary

# Test the full pipeline
node test_pipeline.js
```

### Demo Files

Download CS2 match demos from:
- HLTV.org
- Faceit
- ESEA
- Your own CS2 matches

Supported maps: de_dust2, de_mirage, de_inferno, de_nuke, de_overpass, de_ancient, de_anubis, de_vertigo, de_cache

## Project Structure

```
CS2_Replay_Viewer/
├── backend/           # Go parser and sidecar
├── proto/            # Protobuf schema
├── src-tauri/        # Tauri Rust shell
├── src/              # SvelteKit frontend
│   ├── lib/          # Core modules
│   ├── components/   # Svelte components
│   └── routes/       # Page routes
├── static/           # Map data (radar PNGs + coords)
├── src-tauri/binaries/# Sidecar executable (built automatically)
└── README.md        # Project documentation
```

## Technical Highlights

### Coordinate System
- **CS2 uses 64-tick hard limit** for all demos
- **World coordinates** (X-East, Y-North, Z-Up)
- **Radar transforms**: Proper Y-axis inversion for north-up maps
- **Map-specific scale factors** (4.4 for most maps)

### Performance Optimizations
- **Canvas 2D layered rendering** for efficient updates
- **Client-side interpolation** for smooth player movement
- **Frame skip logic** for 60 FPS at 128 FPS internal rate
- **Memory pooling** for trail and position buffers

### Error Handling
Comprehensive error handling for:
- **File I/O errors** (file not found, permissions)
- **Parse errors** (corrupted demos, invalid format)
- **Memory errors** (demo too large)
- **Network errors** (when loading from remote)

## Build & Deploy

### Production Build
```bash
# Build protobuf definitions
pnpm run build:proto

# Build Rust sidecar
pnpm run build:tauri

# Build Go sidecar
pnpm run build:go

# Full production build
pnpm tauri build
```

### File Types
- `.dem` files: CS2 match replays
- `.ts`/`.js` files: TypeScript/JavaScript source
- `.rs` files: Rust source (Tauri shell)
- `.png`/`.json` files: Map radar and coordinates
- `.json` files: Configuration and package metadata

## Limitations & Future Work

### Current Scope (v1)
- **Static map backgrounds** (pre-bundled radar images)
- **Basic smoke effect** (binary circles)
- **Three-level navigation** (kill, round, time)
- **Single demo at a time** (no batch processing)

### Future Enhancements (v2+)
- **Dynamic map extraction** from VPK archives
- **Animated smoke trajectories** with expansion/fade
- **3D viewer mode** option
- **Multiple demo comparison**
- **Full match statistics** and analytics
- **Custom themes** and skins
- **Cloud save** and sharing features

## License
MIT License. Free for open source and commercial use.

## Support

For issues, questions, or feature requests:
- GitHub Issues
- Discord community
- Project documentation

---

**Note**: This project is actively under development. The current v1 release focuses on core functionality with performance as the top priority.