# Building Meetily from Source

This fork is **API-only** (no local AI models, no GPU features), so the build
is a plain Tauri build on every platform.

## Prerequisites

- **Rust** (stable, 1.77+) — https://rustup.rs
- **Node.js 18+** and **pnpm** — `npm i -g pnpm`
- **Platform toolchain**:
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Windows: Visual Studio Build Tools with the C++ workload
  - Linux: `build-essential`, `libwebkit2gtk-4.1-dev`, `libssl-dev`,
    `libgtk-3-dev`, `libayatana-appindicator3-dev`, ALSA/PulseAudio dev headers

FFmpeg is downloaded and bundled automatically by the build script (used for
audio decoding in the Import flow) — no manual install needed.

## Development

```bash
cd frontend
pnpm install
pnpm run tauri:dev
```

The Next.js dev server runs on port 3118; Tauri opens the desktop window.

## Production build

```bash
cd frontend
pnpm install
pnpm run tauri:build
```

Bundles land in the workspace `target/release/bundle/`: `macos/meetily.app`
and `dmg/*.dmg` on macOS, NSIS installer on Windows, deb/AppImage on Linux.

There are no GPU feature flags, no model downloads, and no sidecar builds.
API keys (Anthropic for summaries; the cloud ASR provider once integrated)
are configured in the app: onboarding or Settings.
