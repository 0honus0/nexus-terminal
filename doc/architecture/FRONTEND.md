# Frontend Architecture

The Nexus Terminal frontend is a Vue application that owns browser presentation, user interaction, client-side state, and the current HTTP/WebSocket client contracts.

The project compiles with the pinned Vue TypeScript 6 toolchain and targets ES2025. Vite also emits ES2025 for both development transforms and production builds.

## Source layout

```text
packages/frontend/src/
├── assets/        static application assets
├── components/    reusable and feature-facing Vue components
├── composables/   stateful UI/use-case composition
├── config/        frontend configuration
├── features/      feature-oriented frontend modules
├── foundation/    business-agnostic UI/interaction/async primitives
├── locales/       frontend translations
├── router/        route definitions and navigation guards
├── stores/        shared Pinia application state
├── types/         frontend-facing type declarations
├── utils/         narrowly scoped frontend utilities
├── views/         route-level views
└── workers/       browser worker entrypoints
```

The browser application currently consumes historical HTTP and WebSocket contracts. Compatibility for those historical contracts belongs on the backend in `interfaces/http/legacy-api/` and `interfaces/websocket/legacy-api/`. The frontend can therefore be migrated incrementally without pushing historical DTO/message names into backend domain services.

After the frontend has been migrated to the new contracts, both backend `legacy-api/` directories are intended to be deleted as complete compatibility layers.

## Foundation

`src/foundation/` contains business-agnostic primitives that feature code imports and composes.

Dependency direction:

```text
foundation  <-  feature / component / view
```

Current foundation areas are:

- `ui/` — reusable visual shells such as `OverlayPanel`;
- `interaction/` — generic pointer/touch/wheel/resize/drag mechanics;
- `async/` — generic asynchronous coordination such as latest-value persistence.

Feature state, persistence keys, API calls, Workspace protocol handling, and product-specific side effects remain with their owning feature/composable/store instead of being registered in Foundation.

## State and use-case composition

Pinia stores hold application state that must be shared across route/component boundaries. Composables coordinate feature behavior and component lifecycles. Route-level views assemble the larger product surfaces.

The preferred ownership test is simple: state or behavior belongs as close as possible to the feature that gives it meaning. Generic interaction mechanics can move into Foundation when they no longer know which product feature consumes them.

## Backend contract migration

The frontend is still allowed to use the current historical HTTP/WebSocket contract while migration is in progress. The backend compatibility adapters isolate that cost.

A frontend contract migration should proceed endpoint/message family by endpoint/message family. When a family has moved to the clean contract, the corresponding compatibility mapping can be removed from the backend legacy layer. The final state removes both compatibility directories without changing backend Modules or Platform capabilities.

## Build

From the repository root:

```bash
npm run build:frontend
```

The frontend build runs Vue SFC type checking and then Vite production bundling.

Mandatory project-wide engineering rules live in [Engineering Constraints](../ENGINEERING_CONSTRAINTS.md).
