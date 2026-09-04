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

The temporary Backend HTTP/WebSocket compatibility layers have been deleted after the clean frontend contracts became authoritative. Production code must not recreate `interfaces/http/legacy-api/` or `interfaces/websocket/legacy-api/`, add frontend wire-compatibility mappers for historical Nexus DTOs, or leak historical transport shapes back into Modules/Platform.

Constraints:

- Frontend-owned Nexus HTTP models and Backend HTTP Interface DTOs use the clean camelCase contracts. Persistence-specific column names may remain private to repository/infrastructure boundaries.
- WebSocket Interface code uses the clean Workspace/upload/remote-desktop protocols; historical message/framing adapters must not be reintroduced.
- Modules, Platform, Infrastructure, and Bootstrap must not adopt historical transport names/shapes merely to emulate an old frontend contract.
- Permanent transport concerns such as HTTP streaming, WebSocket upgrade/auth/heartbeat/backpressure, and transparent Remote Gateway forwarding remain in Interface/Platform owners as defined by the layer rules.
- Any future compatibility for a genuinely external contract requires an explicit Interface boundary and must not recreate the deleted legacy frontend architecture.

## E2E testing

1. **The repository keeps automated test cases only as E2E under `test/e2e`.** Do not add or retain unit, component, backend-internal, adapter, repository, service, migration, or other non-E2E test suites/spec files, test-framework dependencies, CI test jobs, or orphan test helpers outside the E2E system.
2. **E2E cases may only assert behavior that a real user can reach through the product's real HTTP API, WebSocket protocol, browser UI, or production ingress, or the success/failure of a real external integration invoked by those product surfaces.** Do not import/instantiate internal services, repositories, adapters, registries, migrations, or implementation classes.
3. Test-only fixture/control endpoints may prepare deterministic data, availability, latency, disconnects, or other fault conditions. They are setup/fault-injection tools only: final assertions must use product HTTP/WebSocket/UI/ingress behavior. Fake downstream services may validate received requests and return success/failure, but E2E must not query their internal logs, command traces, file state, counters, or captured requests as the assertion surface. Browser network interception may delay or fault a real product request, but must not fabricate a successful product business response in place of the Backend.
4. Internal architecture/invariants are verified by TypeScript/build checks and the architecture guard, not by a separate automated test suite.
5. Complete browser E2E evidence must run in the repository GitHub Actions environment with the pinned Node/Playwright runner. A local host without the required browser/runtime dependencies is not canonical full-E2E evidence.
6. Every E2E test case must be independently runnable from its declared database baseline; no case, spec, project, or CI group may require another test case to have run first.
7. Normal specs start from the committed deterministic seed. First-run setup coverage is the explicit empty-database exception.
8. A `*.spec.ts` file is the smallest scheduling unit. CI grouping may move whole specs but must not split individual tests from one spec across groups.
9. Product/test directory structure and execution grouping are separate. Test files stay organized by product behavior; group configuration owns load balancing.
10. Do not use `test.describe.serial(...)` to preserve product/database state between cases. Persistent product state is reset before every test case; ordering must never be a prerequisite for correctness.
11. Test cleanup is not the isolation guarantee. The reset baseline must make the next spec correct even when a previous spec fails before cleanup.
12. Every shared E2E surface that can leak state must be reset, including database state, file-backed sessions, SSH/SFTP fixtures, SSH online/offline state, artificial delays/hold flags, and future shared test-server controls.
13. The committed seed is refreshed through the repository seed command and must not be hand-edited. It may contain deterministic test-only credentials/baseline data but not production secrets, user data, runtime sessions, or machine-specific state.
14. Every main E2E spec must be assigned to exactly one execution group. Missing specs, duplicate assignments, and stale paths are invalid.
15. Group generation must be deterministic for identical spec inputs and timing history.
16. Timing noise must not cause constant group reshuffling. Rebalancing uses stabilized historical timings and keeps existing placement when improvement is insignificant.
17. Rebalancing changes scheduling only; it must not change test semantics, seed mode, test data, prerequisites, or behavior inside a spec.
18. Docker deployment smoke validates production-style packaging/ingress separately from the main grouped browser suite; it is not a substitute for user-facing functional E2E.
19. Documentation screenshots reuse real user E2E scenarios instead of creating a parallel screenshot-only implementation-test suite.

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
npm run check:test-policy
npm run build:backend
npm run build:frontend
npm run build:remote-gateway
npm --prefix packages/backend run check:architecture
git diff --check
```

User-facing behavior changes should additionally run the relevant E2E path, with complete browser validation performed through GitHub Actions when full evidence is required.
