# Magnum Opus

Magnum Opus is a desktop-first study workspace built as an npm monorepo. It contains multiple focused applications, shared packages, and release tooling in a single repository so the full workspace can be developed, tested, and shipped consistently.

## Repository Layout

```text
magnum-opus/
  apps/
    flashcards/
    study-shell/
    mcq/
  packages/
    shared-build/
    shared-content/
    shared-storage/
    shared-ui/
  tooling/
    release/
    scripts/
  docs/
```

## Requirements

- Node.js and npm
- Rust + Tauri prerequisites for desktop development and packaging

## Workspace Notes

The repository root is a workspace layer, not a web app entry point. There is intentionally no `index.html` at the root.

App entry files live inside each application:

- `apps/flashcards/index.html`
- `apps/mcq/index.html`

## Install Dependencies

```powershell
npm install
```

## Available Commands

Flashcards:

```powershell
npm run dev:flashcards
npm run build:dist:flashcards
npm run build:desktop:flashcards
npm run test:flashcards
npm run release:flashcards
```

Study Shell:

```powershell
npm run dev:study-shell
npm run build:dist:study-shell
npm run build:desktop:study-shell
npm run test:study-shell
npm run release:study-shell
```

MCQ:

```powershell
npm run dev:mcq
npm run build:dist:mcq
npm run build:desktop:mcq
npm run test:mcq
npm run release:mcq
```

Set validation:

```powershell
npm run validate:set:flashcards
npm run validate:set:mcq
```

## Shared Packages

- `shared-build`: build-time helpers used across apps
- `shared-content`: shared content parsing and validation utilities
- `shared-storage`: storage and persistence helpers
- `shared-ui`: reusable UI/runtime helpers

## Tooling

- `tooling/release`: release-oriented helpers and scripts
- `tooling/scripts`: repository-level utility scripts
