# Frontend Clean Refactor Plan

The detailed business inventory, component ownership, dependency graph, target folders, Workspace/Agent reuse model, and rewrite sequence are defined in:

- [`FRONTEND_DEPENDENCY_ANALYSIS.md`](./FRONTEND_DEPENDENCY_ANALYSIS.md)

Execution order is fixed as:

1. analyze and freeze ownership/dependency graph;
2. retain the old frontend backup;
3. keep a compiling clean skeleton;
4. complete base/shared UI infrastructure;
5. rewrite UI and product functionality by final owner;
6. compose Workspace from reusable capability ports;
7. implement Agent without Workspace-internal dependencies;
8. only then align frontend HTTP/WS contracts with Backend clean Interfaces and remove backend compatibility layers;
9. pass formatting, architecture, test-policy, build and relevant E2E gates.

Old frontend paths are not preserved through compatibility re-exports, and feature restoration is a rewrite rather than a source-file move.
