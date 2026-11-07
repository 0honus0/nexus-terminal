# Pinned upstream package builds

The eight `plugin-source` directories contain verbatim files from the official
GitHub Actions signed `nexus-agent-plugins` release archives. Nexus Agent is
2.0.1 from `0bf6cbb019a98cfecff9d194c5d4fa2dc1325c80` (v2.0.1); UI/tool packages
are 2.0.0 from `e19e7049d81b3aa0d7ec533dce24ce4a726668dc` (v2.0.0);
MCP/ACP service packages are 4.0.0. All require Host 1.1.0 and manifest schema 4.
Backend packages use SDK 4, and Chat UI uses frontend SDK 4. Do not format signed
payloads, generated bundles or assets.

| Package                  | Responsibility                          | Provenance                                                               |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------------ |
| nexus.agent              | App loop, context, titles, compaction   | [agent-app-provenance.json](agent-app-provenance.json)                   |
| nexus.tools.remote       | Remote file and command tools           | [remote-tools-provenance.json](remote-tools-provenance.json)             |
| nexus.tools.browser      | Browser tools                           | [browser-tools-provenance.json](browser-tools-provenance.json)           |
| nexus.tools.integrations | Protocol tool consumers                 | [integrations-tools-provenance.json](integrations-tools-provenance.json) |
| nexus.tools.agent        | Agent, artifact and configuration tools | [agent-tools-provenance.json](agent-tools-provenance.json)               |
| nexus.ui.chat            | Independent chat Surface                | [ui-chat-provenance.json](ui-chat-provenance.json)                       |
| nexus.services.mcp       | MCP SDK and protocol sessions           | [mcp-service-provenance.json](mcp-service-provenance.json)               |
| nexus.services.acp       | ACP SDK and protocol sessions           | [acp-service-provenance.json](acp-service-provenance.json)               |

Each provenance records the exact upstream commit, original signed publisher,
archive hash/size and all extracted file hashes. Aggregate file-list hashes use
UTF-8 `JSON.stringify(array)` with no trailing newline. The independent repository
consumes Shared 4.0.2 and public SDK4 bundles. Historical SDK3 evidence does not
describe this baseline.

Tools and service schemas are registered dynamically by their provider. The App
owns model exposure and lazy tool loading; the Host owns exact instance bindings,
current authority, Operations, complete content and resource drainage. Dependency
services remain available without automatically exposing their tools to a model.

`buildPinnedPluginPackage` verifies every recorded payload, rejects missing,
extra or nonregular files, validates the V4 signature and signed file list, then
reconstructs the deterministic GNU tar 1.35 archive with normalized file permissions.
The runner pins the same tar version as the release packager: GNU tar 1.34 encodes
zero device fields differently even in ustar mode. Its bytes, SHA-256 and size must match the
independent archive exactly. It preserves the manifest, runtime, `files.json`,
`signature.ed25519`, staged versions and dependency publisher bindings. It never
changes a package to satisfy Host checks.

The official publisher identity is preserved from each release descriptor.
Custom test packages use a separate fixture signing key; catalog and installation
helpers explicitly trust each actual publisher. Recommended-install fixtures
configure their test publisher without weakening production verification. Tests
require no external checkout, task artifact path or public network. Package and
protocol checks do not replace complete Host execution or browser acceptance.
