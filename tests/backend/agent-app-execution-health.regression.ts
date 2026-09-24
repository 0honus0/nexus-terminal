import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const availability = read('packages/frontend/src/features/agent/app-availability.ts');
assert(availability.includes("health === 'healthy' || health === 'degraded'"));

const host = read('packages/frontend/src/features/agent/host/AgentSurfaceHost.vue');
assert(host.includes('const executable = enabled.filter(canExecuteAgentApp);'));
assert(host.includes('current && (canExecuteAgentApp(current) || executable.length === 0)'));

const hub = read('packages/frontend/src/features/agent/host/AgentHubWindow.vue');
assert(hub.includes(':app-health="resident.health"'));
assert(hub.includes(':app-health-reason="resident.healthReason"'));

const surface = read('packages/frontend/src/features/agent/host/AgentAppSurface.vue');
assert(surface.includes('const appExecutable = computed(() => isAgentAppExecutableHealth(props.appHealth));'));
assert(
  surface.includes(
    "if (!appExecutable.value && !(submission.kind === 'command' && submission.command.kind === 'help')) return;",
  ),
);
assert(surface.includes('agent.operations.appUnavailable'));

process.stdout.write('agent app execution health regression: PASS\n');
