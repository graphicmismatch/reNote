# reNote

A local-first note-taking app with an infinite drawing canvas, for Windows, macOS, Linux (Electron) and Android (Capacitor). Both shells run the same React build.

## Stack

- **App**: React + [PixiJS](https://pixijs.com/) for the canvas, [ProseMirror](https://prosemirror.net/) for rich text, bundled with Vite.
- **Storage**: IndexedDB on the device (`apps/desktop/src/providers/idb-store.ts`). Data stays on the device: no server, no account.
- **Shells**: [Electron](https://www.electronjs.org/) for desktop (`apps/electron`), [Capacitor](https://capacitorjs.com/) for Android (`apps/desktop/android`).
- **Monorepo**: pnpm workspaces + [Turborepo](https://turbo.build/repo).

## Packages

| Package                   | Purpose                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/desktop`            | The React composition root wiring everything together, plus the IndexedDB-backed storage client.         |
| `packages/core`           | Framework-agnostic domain models: notebooks, sections, pages, page objects, commands, search, event bus. |
| `packages/canvas-engine`  | Framework-agnostic infinite canvas engine: scene graph, tool/command registries, ink capture, rendering. |
| `packages/text-editor`    | DOM-based rich-text field overlaid on the canvas, camera-synced (ProseMirror-backed).                    |
| `packages/ui`             | Black-and-white pixel design system (React), light/dark chrome tokens.                                   |
| `packages/storage-client` | The `StorageClient` interface and its DTOs.                                                              |
| `packages/shortcuts`      | Keymap built on the shared `AppCommand` registry.                                                        |

## Getting started

Requires Node ≥20 and [pnpm](https://pnpm.io/) 11. Android builds also need the Android SDK and a JDK (Android Studio installs both).

```bash
pnpm install
pnpm desktop                        # build and launch the Electron app
pnpm --filter @renote/desktop dev   # UI dev server with hot reload, http://localhost:1420
```

## Building installers

**Desktop.** `pnpm dist:desktop` writes installers to `apps/electron/release/`: on Linux an `.AppImage` and a `.deb`, on Windows an `.exe` (NSIS), on macOS a `.dmg`. Run it on each OS you're targeting, since electron-builder only reliably builds for the OS it runs on. The macOS and Windows builds are unsigned until you add signing certificates.

**Android.** `pnpm android` builds the app and copies it into the Android project. Then either open `apps/desktop/android` in Android Studio, or run `./gradlew assembleDebug` inside it. The APK lands in `app/build/outputs/apk/`.

Notes are stored per device. Use **Back Up Notebook** / **Restore Notebook Backup** (a `.renote.json` file) to move a notebook between devices. On Android, exports and backups open the share sheet so you can save them to Files or Drive. PDF export opens the system print dialog, where you choose _Save as PDF_.

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
