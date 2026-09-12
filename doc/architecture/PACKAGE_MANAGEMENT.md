# Package Management Architecture

Nexus Terminal uses a single pnpm workspace as the repository package-management boundary.

## Workspace ownership

The workspace root is the only lockfile owner:

- `packages/backend` — Backend runtime package;
- `packages/frontend` — Browser application package;
- `packages/agent-runner` — Agent Runner/Controller package;
- `packages/e2e` — Playwright E2E package;
- repository root — engineering scripts and shared formatting tooling.

These packages stay separate because they have different runtime/deployment lifecycles. Do not merge them merely to share dependencies, and do not create a shared package for configuration that does not contain a real reusable runtime/build API.

`pnpm-workspace.yaml` and the root `pnpm-lock.yaml` are the only workspace/lockfile authority. Workspace members must not add local `package-lock.json`, nested `pnpm-lock.yaml`, or independent install flows.

## Dependency version policy

Use the default/named pnpm catalogs only for dependencies whose versions are intentionally shared by multiple workspace packages. Package-specific dependencies keep their range in the owning `package.json`.

The workspace `allowBuilds` map is the supply-chain authority for dependency lifecycle scripts. New packages with install/build scripts must be reviewed and explicitly allowed or denied; do not disable pnpm's strict dependency-build checks globally.

The root `packageManager` field pins the pnpm release used by local tooling, CI, and Docker builds. A package-manager major upgrade requires checking lockfile compatibility with GitHub dependency/security tooling before changing that pin.

## Install and build contract

Install once from the repository root:

```bash
pnpm install --frozen-lockfile
```

Run package tasks through workspace filters or the root aliases:

```bash
pnpm run build:backend
pnpm run build:frontend
pnpm run build:agent-runner
pnpm run test:e2e:groups:check
```

Root scripts may orchestrate workspace packages, but package scripts must not run a second package-manager install. `scripts/build/build.sh local ...` assumes the workspace install has already completed.

## Production packaging

Docker builders install from the root workspace lockfile. Backend and Agent Runtime production trees are created with `pnpm deploy --prod`, then only the deployed `dist`, `node_modules`, and `package.json` are copied into the runtime image. Do not restore per-package `npm ci`/`npm prune` stages.

The Frontend remains a build artifact only: the builder consumes workspace dependencies and copies `dist` into nginx.

## CI and dependency updates

GitHub Actions uses `pnpm/setup` with the repository pin and a Node runtime selected by the E2E environment policy. CI installs use the shared lockfile and frozen mode.

Dependency refreshes update Frontend/Backend direct dependencies and shared catalog entries through pnpm, then regenerate the single root lockfile and build Frontend, Backend, and Agent Runtime because catalog changes can affect more than the package whose direct range changed. A catalog change may intentionally affect another package that references the same catalog entry; this is the point of the shared version policy and must be visible in review.
