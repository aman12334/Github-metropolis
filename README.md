# Cyber City: GitHub Skyline

A cyberpunk-style 3D city built with React + Vite + Three.js, where each building represents a GitHub user.

## Tech Stack

- React (Vite)
- `@react-three/fiber`
- `@react-three/drei`
- `@react-three/postprocessing`
- Three.js

## Core Idea

Each GitHub user is mapped to a building:

- `height = 2 + public_repos * 0.4` (plus tier scaling)
- `width = 1 + log(followers + 1)` (plus tier scaling)
- visual prominence scales with user score (`followers + repos` weighting)

The city uses downtown clustering so high-value users are concentrated toward the center and form a proper skyline.

## Features

- Real GitHub data integration using live geolocation (reverse geocoding + nearby location search)
- Default user injection (`your-GitHub-username`)
- Add any GitHub username into the city
- Search and highlight any available username
- Add missing searched users directly from the UI
- Building click panel with profile confirmation (`Visit Profile`)
- Third-person helicopter flight
- Collision system with soft bounce + hard crash/respawn
- Search camera assist + jump-to-highlighted mini-map
- Context-aware labels (reduced clutter)
- Visual presets:
  - Dystopian Night
  - Tron Neon
  - Dawn Haze
- Fog + controlled bloom for cinematic depth
- Stats panel (FPS, building count, GitHub rate status)
- Local persistence of added users (`localStorage`)

## Controls

- `Arrow Up` / `Arrow Down`: forward/back thrust
- `Arrow Left` / `Arrow Right`: yaw turn
- `E` or `Space`: move up
- `Q` or `Shift`: move down
- `Right Mouse Drag` (or middle mouse): look around
- `R`: recenter view

## UI Quick Guide

- **Add GitHub** panel: add a username to city
- **Search Building** panel: highlight and focus a user tower
- **Add Missing User** button: appears when searched user is not in city
- **Focus Downtown**: moves navigation focus to skyline core
- **Mini Map**: shows helicopter + building points and lets you jump near highlighted user

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` in project root:

```env
VITE_GITHUB_TOKEN=your_github_token_here
```

3. Start dev server:

```bash
npm run dev
```

4. Open:

```text
http://localhost:5173
```

## Build

```bash
npm run build
```

## Notes

- Keep your GitHub token private. Do not commit real tokens to public repos.
- If GitHub rate limits are hit, search/add calls may fail until reset time.
- On first load, browser location permission is requested to build a local city. If denied, a broad fallback region is used.
- For smoother FPS on laptops, use lower browser zoom and keep other GPU-heavy tabs closed.
