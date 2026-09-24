import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (relativePath: string): string => fs.readFileSync(new URL(relativePath, root), 'utf8');

const server = read('packages/agent-runner/src/controller/server.ts');
const lifecycleGate = server.indexOf(
  'const releaseLifecycleDrain = this.dependencies.runtimeEngine.beginWorkspaceLifecycleDrain',
);
const restartStart = server.indexOf("if (command.action === 'restart')", lifecycleGate);
const restartEnd = server.indexOf("this.save(workspace, 'running');", restartStart);
const restartBranch = server.slice(restartStart, restartEnd + 64);
assert(lifecycleGate >= 0 && lifecycleGate < restartStart);
const acpClose = restartBranch.indexOf('this.dependencies.acpRuntime.closeWorkspace');
const terminalClose = restartBranch.indexOf('this.dependencies.terminalRuntime.closeWorkspace');
const pluginDispose = restartBranch.indexOf('await this.dependencies.pluginRunner.disposeWorkspace');
const runtimeRestart = restartBranch.indexOf('await this.dependencies.runtimeEngine.restart');
const pluginActivate = restartBranch.indexOf('await this.dependencies.pluginRunner.activateWorkspace');
const runningCommit = restartBranch.indexOf("this.save(workspace, 'running')");
assert(acpClose >= 0 && terminalClose >= 0);
assert(acpClose < pluginDispose && terminalClose < pluginDispose);
assert(pluginDispose < runtimeRestart);
assert(runtimeRestart < pluginActivate);
assert(pluginActivate < runningCommit);
assert(server.indexOf('releaseLifecycleDrain();', restartEnd) > restartEnd);

const acp = read('packages/agent-runner/src/controller/acp-process-runtime.ts');
assert(acp.includes('async closeWorkspace(workspaceId: string, generation?: number): Promise<void>'));
assert(acp.includes('.map((process) => process.close())'));
const acpTerminate = acp.indexOf('closePromise = terminateManagedProcess(child).then(() => {');
const acpDelete = acp.indexOf('this.active.delete(active);', acpTerminate);
const acpRelease = acp.indexOf('releaseOwnership();', acpDelete);
assert(acpTerminate >= 0 && acpTerminate < acpDelete && acpDelete < acpRelease);

const terminal = read('packages/agent-runner/src/controller/workspace-terminal-runtime.ts');
assert(terminal.includes('async closeWorkspace(workspaceId: string, generation?: number): Promise<void>'));
assert(terminal.includes('.map((terminal) => terminal.close())'));
const terminalCloseEvent = terminal.indexOf("child.once('close'");
const terminalDelete = terminal.indexOf('this.active.delete(active);', terminalCloseEvent);
const terminalResolve = terminal.indexOf('resolveClose?.();', terminalDelete);
const terminalRelease = terminal.indexOf('releaseOwnership();', terminalResolve);
assert(
  terminalCloseEvent >= 0 &&
    terminalCloseEvent < terminalDelete &&
    terminalDelete < terminalResolve &&
    terminalResolve < terminalRelease,
);

const engine = read('packages/agent-runner/src/controller/workspace-runtime-engine.ts');
const engineRestart = engine.indexOf('async restart(workspaceId: string, generation: number): Promise<void>');
const jobDrain = engine.indexOf('await this.drainJobs(', engineRestart);
const runtimeRestartCall = engine.indexOf('this.runtime.restart(workspaceId, generation)', jobDrain);
assert(engineRestart >= 0 && engineRestart < jobDrain && jobDrain < runtimeRestartCall);
assert(engine.includes('this.workspaceLifecycleDrains.has(key)'));

process.stdout.write('workspace restart owner barrier regression: PASS\n');
