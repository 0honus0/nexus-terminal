# Plugin frontend SDK

This directory owns the browser runtime for signed UI packages inside the frontend. It depends only on the public Shared contracts and is built as the Host's public `/sdk/frontend-v4.mjs` module. It is not a separate workspace or npm package. Host bridge and authenticated transport adapters live beside it in `../host/` and are excluded from this runtime.

An independent UI declares the public module using Shared types and configures its bundler to keep `nexus:frontend-sdk` external and render its import as `/sdk/frontend-v4.mjs`. No Host source import or runtime archive participates in that UI build. The factory and named failure constructor then come from the same Host module instance:

```ts
import { connectNexusPlugin } from 'nexus:frontend-sdk';

const sdk = await connectNexusPlugin();
const environment = await sdk.ui.ready;
const stopEnvironment = sdk.ui.onEnvironment((next) => {
	// Apply locale, theme variables and current window state.
});
const stopClose = sdk.ui.onClose(() => {
	// Dispose local view state and listeners.
});
```

`request` exposes the finite application RPCs. `ui.request` exposes trusted browser interactions such as confirmation, resource closure, file selection and upload. Authentication, grants and actual resources remain with their Host owners. UI requests settle on a response, explicit cancellation, connection closure or the original frontend grant expiry delivered in the v3 handshake. They do not impose a shorter universal timeout on human interactions or uploads.

`ui.streams.subscribe` accepts the public `AgentPluginUiStreamConsumer` contract from `@nexus-terminal/shared/agent/plugins/ui-streams`. Its source is either `{kind: 'run', runId, cursor}` or `{kind: 'memory', threadId}`. The Host supplies the authenticated App and UI grant. Run pages contain committed text, title, Run state, usage, approvals, children and resource state. Memory pages invalidate the current list.

The consumer returns `false` to retain a page and calls `resume()` when it can apply it. A page is acknowledged only after successful application. The Host owns reconnects and resumes from the last applied cursor. Subscription `close()` releases its local page and detaches it; `closed` confirms that local subscription ended. `sdk.close()` is idempotent and waits for SDK delivery cleanup. Local cancellation never proves a remote operation stopped or rolled back. A dispatched mutation cancelled before confirmation retains `outcome: 'unknown'`. Read-only selection lookup and confirmation carry no mutation uncertainty; their cancellation after dispatch uses `outcome: 'confirmed'`, which does not claim a successful result.

The environment carries `checkpoint: null | {version, valueJson}`. A UI saves its own state through `ui.request({kind: 'checkpoint.save', checkpoint})`. The Host isolates this state by authenticated App, signed UI package and publisher and enforces complete message budgets. The UI owns the schema version and strict decoding of its payload. The Host keeps this state only for the current authenticated browser session; it is not an execution journal or authority. Successful explicit App data purge clears that App’s checkpoints; normal UI package updates preserve them.

SDK and manifest version 3 are required. There is no v2 runtime fallback. The frontend builds the public runtime asset and the backend copies that built asset into its deployment output; backend runtime code never compiles or imports frontend source. Independent UI releases package their own UI source and Shared contract dependency, while the Host delivers this protocol 3 runtime.
