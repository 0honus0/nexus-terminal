# Engineering Constraints

This is the authoritative constraint register for the entire Nexus Terminal repository. Architecture documents may explain the design, but mandatory engineering rules are recorded here.

## Constraint change process

- New engineering constraints must be added to this file.
- If a new instruction conflicts with an existing constraint, do not silently overwrite either rule. Report the conflict and ask the project owner which rule should win.
- Once the project owner resolves a conflict, update this file so it represents the current decision before treating the new rule as established project policy.
- Implementation details that are not intended to constrain future work should stay in their corresponding architecture/feature document instead of being promoted into this register.

## General engineering

1. **Format code before every commit.** Use `npm run format` to format every changed/new Prettier-supported file in the pending commit, then `npm run format:check`; `git diff --check` must also stay clean. `npm run format:all` is reserved for an intentional repository-wide normalization change.
2. **ES2025 is the JavaScript baseline for the whole application.** Backend, frontend TypeScript, frontend Vite output, and Remote Gateway target ES2025.
3. **Keep responsibilities close to their owner.** Do not use `shared`, `utils`, `helpers`, Foundation, or another generic location as a miscellaneous dumping ground.
4. **Do not add compatibility aliases to permanent layers merely to preserve an old internal file/class shape.** Compatibility is justified only for a real externally consumed contract and must be isolated at the appropriate interface boundary.

## Dependency and module architecture

The backend dependency direction is one-way:

```text
interfaces  →  modules  →  platform
                    ↑        ↑
                    │        │
              bootstrap   infrastructure

bootstrap constructs the complete graph
shared is only for genuinely cross-cutting primitives
```

The concrete allowed layer edges are:

| From             | Allowed dependencies                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `shared`         | `shared`                                                                                                                    |
| `config`         | `config`, `shared`                                                                                                          |
| `platform`       | `platform`, `shared`                                                                                                        |
| `modules`        | `modules`, `platform`, `shared`                                                                                             |
| `infrastructure` | `infrastructure`, `platform`, `shared`; type-only Module `*.port` / `*.types` imports when implementing a Module-owned port |
| `interfaces`     | `interfaces`, `modules`, `platform`, `shared`                                                                               |
| `bootstrap`      | all application layers for composition/lifecycle                                                                            |
| root `index.ts`  | Bootstrap only                                                                                                              |

Additional module rules:

- **Modules must stay functionally decoupled and their dependency relationships must remain one-way.** Cross-module collaboration goes through an explicit service/port contract owned by the appropriate domain; mutual module dependencies are forbidden.
- The Module dependency graph must be acyclic, even when a module-level cycle would not happen to form an obvious single-file cycle.
- Circular source dependencies are forbidden across the whole backend.
- Platform and Modules must not import `express`, `ws`, or `ssh2`.
- Interfaces must not import Bootstrap or Infrastructure concrete implementations.
- Infrastructure must not runtime-import Modules. Type-only imports of Module ports/types are allowed only when Infrastructure implements that Module-owned contract.
- Bootstrap is the only layer that constructs and owns the complete concrete dependency graph.
- SQL schemas/column names and encrypted persistence records stay in Infrastructure; HTTP/WebSocket DTO names stay in Interfaces; Modules use domain/application names.

### Layer responsibility constraints

- **Platform** contains reusable machine capabilities that remain meaningful without the Nexus UI, HTTP API, user database, or Workspace product model.
- **Infrastructure** contains concrete technology implementations such as SQLite, `ssh2`, filesystem/network clients, crypto, SMTP/Webhook/Telegram, Guacamole adapters, and local host metrics.
- **Modules** own Nexus product policy, persisted product concepts, authorization/ownership, and use-case orchestration.
- **Interfaces** translate HTTP/WebSocket transport contracts to injected Module/Platform use cases. They may own protocol state such as HTTP Range semantics or WebSocket frame ACK/backpressure, but not product resource-ownership rules.
- **Bootstrap** owns construction, configuration, startup/shutdown, and process lifecycle.
- **Shared** is only for primitives that genuinely have no stronger owner.

### Service/repository/adapter constraints

- Application services orchestrate use cases and policy; they do not execute SQL or construct concrete transports.
- Repository ports are owned by the Module/domain that needs persistence; SQLite implementations live in Infrastructure.
- Technology-specific APIs remain behind ports/adapters. Raw `ssh2.Client`, SFTP wrappers/handles, database adapters, Axios clients, and similar concrete resources must not leak into Modules or Interfaces.
- HTTP controllers and WebSocket protocol handlers translate transport input/output only; they must not become alternate business-service layers.

## Workspace, execution, and Agent boundaries

- Workspace session state contains product/platform objects, not WebSocket objects, raw SSH clients, SFTP wrappers/handles, ACK maps, or serialized frames.
- Execution sessions own their machine transport/resources. Technology-specific channel pooling remains in Infrastructure.
- Workspace and any future Agent runtime must own separate execution/runtime state. They must not share raw SSH clients, shell channels, SFTP handles, cwd/process state, or active command sessions.
- A future Agent should consume the same Platform capabilities and Module diagnostics services rather than automate the Workspace UI or receive raw Infrastructure handles.

## Diagnostics constraints

- Diagnostics are read-only observational capabilities, not arbitrary command execution or repair APIs.
- Platform defines generic diagnostic probes; Modules/System owns aggregation, actor/scope policy, and redaction; Bootstrap registers probes.
- Agent/user diagnostics must go through `SystemDiagnosticsService` / `compositionRoot.modules.diagnostics`, not raw repositories, SSH clients, process internals, or database handles.
- Diagnostic output must never expose credentials, authorization headers, session cookies, passwords, private keys, raw secrets, or arbitrary command output. Sensitive detail keys must be redacted before observations leave the service boundary.

## Legacy frontend compatibility

Exactly two temporary backend compatibility directories exist for the current frontend contracts:

```text
packages/backend/src/interfaces/http/legacy-api/
packages/backend/src/interfaces/websocket/legacy-api/
```

Constraints:

- Historical HTTP snake_case DTOs, old WebSocket message names, NXTM/NXUP framing, and other current-frontend compatibility behavior stay inside these temporary Interface adapters.
- Modules, Platform, Infrastructure, and Bootstrap must not adopt or import legacy protocol names/shapes.
- HTTP legacy compatibility may only be consumed by `interfaces/http`; WebSocket legacy compatibility may only be consumed by `interfaces/websocket`.
- Permanent WebSocket transport concerns such as upgrade/auth/heartbeat and transparent remote-desktop forwarding stay outside the compatibility directory.
- When the frontend moves to the clean contracts, each `legacy-api/` directory is deleted as a whole. The migration must not require changes to Module or Platform APIs merely to remove these adapters.

## E2E and regression testing

1. **New E2E cases may only test behavior that a real user can reach through the product's real HTTP API, WebSocket protocol, browser UI, or production ingress.** Do not add Playwright E2E that imports/instantiates internal services, repositories, adapters, registries, or other implementation classes.
2. Internal architecture/invariant coverage belongs in TypeScript checks, the architecture guard, or focused lower-level regression tests—not user E2E.
3. Complete browser E2E evidence must run in the repository GitHub Actions environment with the pinned Node/Playwright runner. A local host without the required browser/runtime dependencies is not canonical full-E2E evidence.
4. Every E2E spec must be independently runnable from its declared baseline; no spec/project may require another spec/project to have run first.
5. Normal specs start from the committed deterministic seed. First-run setup coverage is the explicit empty-database exception.
6. A `*.spec.ts` file is the smallest scheduling unit. CI grouping may move whole specs but must not split individual tests from one spec across groups.
7. Product/test directory structure and execution grouping are separate. Test files stay organized by product behavior; group configuration owns load balancing.
8. `test.describe.serial(...)` is allowed only for deliberate state sharing inside one spec. No serial dependency may cross a spec boundary.
9. Test cleanup is not the isolation guarantee. The reset baseline must make the next spec correct even when a previous spec fails before cleanup.
10. Every shared E2E surface that can leak state must be reset, including database state, file-backed sessions, SSH/SFTP fixtures, SSH online/offline state, artificial delays/hold flags, and future shared test-server controls.
11. The committed seed is refreshed through the repository seed command and must not be hand-edited. It may contain deterministic test-only credentials/baseline data but not production secrets, user data, runtime sessions, or machine-specific state.
12. Every main E2E spec must be assigned to exactly one execution group. Missing specs, duplicate assignments, and stale paths are invalid.
13. Group generation must be deterministic for identical spec inputs and timing history.
14. Timing noise must not cause constant group reshuffling. Rebalancing uses stabilized historical timings and keeps existing placement when improvement is insignificant.
15. Rebalancing changes scheduling only; it must not change test semantics, seed mode, test data, prerequisites, or behavior inside a spec.
16. Docker deployment smoke validates production-style packaging/ingress separately from the main grouped browser suite; it is not a substitute for user-facing functional E2E.
17. Documentation screenshots reuse real user E2E scenarios instead of creating a parallel screenshot-only implementation-test suite.

## Documentation constraints

- Full narrative documentation belongs under `doc/`.
- Package/subdirectory README files are navigation stubs only and link to the corresponding document under `doc/`.
- The root README stays concise and acts as the project landing page/navigation entry rather than duplicating internal architecture narratives.
- Mandatory engineering constraints are centralized in this file. Other documents should link here instead of creating a competing source of engineering rules.

## Verification commands

The normal pre-commit verification set for architecture-affecting changes is:

```bash
npm run format
npm run format:check
npm run build:backend
npm run build:frontend
npm run build:remote-gateway
npm --prefix packages/backend run check:architecture
git diff --check
```

User-facing behavior changes should additionally run the relevant E2E path, with complete browser validation performed through GitHub Actions when full evidence is required.
