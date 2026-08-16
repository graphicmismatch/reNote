# reNote

A local-first, cross-platform note-taking app with an infinite drawing canvas. Built with Tauri (Rust) + React.

## Stack

- **Desktop shell**: [Tauri 2](https://tauri.app/) — Rust backend, system webview frontend.
- **Frontend**: React + [PixiJS](https://pixijs.com/) for the canvas, [ProseMirror](https://prosemirror.net/) for rich text.
- **Storage**: SQLite + filesystem, driven entirely from Rust (`src-tauri/crates/renote-storage`, `renote-index`) — the frontend only talks to it through a typed `invoke` facade.
- **Monorepo**: pnpm workspaces + [Turborepo](https://turbo.build/repo).

## Packages

| Package | Purpose |
|---|---|
| `apps/desktop` | The Tauri + React composition root wiring everything together. |
| `packages/core` | Framework-agnostic domain models: notebooks, sections, pages, page objects, commands, search, event bus. |
| `packages/canvas-engine` | Framework-agnostic infinite canvas engine: scene graph, tool/command registries, ink capture, rendering. |
| `packages/text-editor` | DOM-based rich-text field overlaid on the canvas, camera-synced (ProseMirror-backed). |
| `packages/ui` | Black-and-white pixel design system (React), light/dark chrome tokens. |
| `packages/storage-client` | Thin typed facade over Tauri's `invoke` bridge. |
| `packages/shortcuts` | Keymap built on the shared `AppCommand` registry. |
| `src-tauri` | The Rust side: Tauri app + `renote-*` crates (storage, index, audio, import, export, commands). |

## Getting started

Requires Node ≥20, [pnpm](https://pnpm.io/) 11, and a [Rust toolchain](https://www.rust-lang.org/tools/install).

```bash
pnpm install
pnpm tauri dev     # launch the desktop app
```

## Common tasks

```bash
pnpm build         # build all workspace packages + the desktop app
pnpm dev           # run all packages in dev/watch mode
pnpm lint          # eslint across the workspace
pnpm typecheck     # tsc --noEmit across the workspace
pnpm test          # vitest across the workspace
pnpm format        # prettier --write
pnpm boundary-lint # enforce package dependency rules (dependency-cruiser)
```

Rust checks (from `src-tauri/`):

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo build --workspace
cargo test --workspace
```

## Releases

Pushing a tag matching `v*` triggers `.github/workflows/release.yml`, which builds installers for Linux (`.deb`/`.rpm`/`.AppImage`), Windows (`.msi`/`.exe`), and macOS (`.dmg`), and publishes them as a draft GitHub Release.

```bash
git tag v0.1.0
git push origin v0.1.0
```
