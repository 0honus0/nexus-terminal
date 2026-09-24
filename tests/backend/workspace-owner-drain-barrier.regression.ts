import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const acp = read('packages/agent-runner/src/controller/acp-process-runtime.ts');
assert(acp.includes('async closeWorkspace(workspaceId: string, generation?: number): Promise<void>'));
assert(acp.includes('.map((process) => process.close())'));
assert(
  acp.includes('closePromise = terminateManagedProcess(child).then(() => {\n          this.active.delete(active);'),
);
assert(!acp.includes('this.active.delete(active);\n        void terminateManagedProcess(child);'));

const terminal = read('packages/agent-runner/src/controller/workspace-terminal-runtime.ts');
assert(terminal.includes('async closeWorkspace(workspaceId: string, generation?: number): Promise<void>'));
assert(terminal.includes('.map((terminal) => terminal.close())'));
assert(terminal.includes("reject(new Error('WORKSPACE_OWNER_DRAIN_TIMEOUT'))"));
assert(terminal.indexOf('this.active.delete(active);') > terminal.indexOf("child.once('close'"));

const server = read('packages/agent-runner/src/controller/server.ts');
const lifecycle = server.slice(server.indexOf("if (command.action === 'stop')"), server.indexOf('private save('));
assert.equal((lifecycle.match(/await Promise\.all\(\[/g) ?? []).length, 3);
assert(lifecycle.indexOf('await Promise.all([') < lifecycle.indexOf('runtimeEngine.stop('));
assert(lifecycle.lastIndexOf('await Promise.all([') < lifecycle.indexOf('runtimeEngine.remove('));

const managed = read('packages/agent-runner/src/managed-process.ts');
assert(managed.includes("throw new Error('MANAGED_PROCESS_TERMINATION_TIMEOUT')"));

process.stdout.write('workspace owner drain barrier regression: PASS\n');
