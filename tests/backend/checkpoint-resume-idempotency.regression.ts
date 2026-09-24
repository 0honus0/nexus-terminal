import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (relativePath: string): string => fs.readFileSync(new URL(relativePath, root), 'utf8');

const api = read('packages/frontend/src/features/agent/api/agent-api.ts');
const resumeApiStart = api.indexOf('async resumeRun(');
const resumeApiEnd = api.indexOf('async cancelRun(', resumeApiStart);
const resumeApi = api.slice(resumeApiStart, resumeApiEnd);
assert(resumeApiStart >= 0 && resumeApiEnd > resumeApiStart);
assert(resumeApi.includes('idempotencyKey: string'));
assert(resumeApi.includes("'Idempotency-Key': idempotencyKey"));
assert(!resumeApi.includes('crypto.randomUUID()'), 'resume API must not mint a new key per transport attempt');

const facade = read('packages/frontend/src/features/agent/runtime/run-facade.ts');
assert(facade.includes('resumeRun: async (run: AgentRunViewDto, checkpointId: string, idempotencyKey: string) =>'));
assert(
  facade.includes('runStore.accept(await agentApi.resumeRun(appId, currentRun(run), checkpointId, idempotencyKey))'),
);

const surface = read('packages/frontend/src/features/agent/host/AgentAppSurface.vue');
const resumeStart = surface.indexOf('let pendingCheckpointResumeIdentity:');
const resumeEnd = surface.indexOf('const deleteRun = async', resumeStart);
const resumeSurface = surface.slice(resumeStart, resumeEnd);
assert(resumeStart >= 0 && resumeEnd > resumeStart);
assert(resumeSurface.includes('const fingerprint = JSON.stringify([snapshot.id, checkpoint.id, snapshot.version]);'));
assert(
  resumeSurface.includes('pendingCheckpointResumeIdentity = { fingerprint, idempotencyKey: crypto.randomUUID() };'),
);
assert(resumeSurface.includes('const idempotencyKey = checkpointResumeIdempotencyKey(snapshot, checkpoint);'));
assert(resumeSurface.includes('const resumed = await facade.resumeRun(snapshot, checkpoint.id, idempotencyKey);'));
const successClear = resumeSurface.indexOf('if (pendingCheckpointResumeIdentity?.idempotencyKey === idempotencyKey)');
const catchStart = resumeSurface.indexOf('} catch (cause) {');
assert(successClear > 0 && catchStart > successClear);
const catchBody = resumeSurface.slice(catchStart);
assert(
  !catchBody.includes('pendingCheckpointResumeIdentity = null'),
  'failed/unknown restore outcomes must retain the recovery intent key for retry',
);

const checkpointService = read('packages/backend/src/modules/agent/runtime/recovery/checkpoint.service.ts');
const backendResumeStart = checkpointService.indexOf('async resume(');
const backendResume = checkpointService.slice(backendResumeStart);
assert(backendResume.includes('const key = requireIdempotencyKey(idempotencyKey);'));
assert(backendResume.includes('idempotencyKey: key,'));
const createCommit = backendResume.indexOf('const committed = await this.stateCommit.createRun({');
const workspaceRestore = backendResume.indexOf('await this.workspaceCheckpoints.restore(', createCommit);
assert(createCommit >= 0 && workspaceRestore > createCommit);
assert(
  checkpointService.includes("checkpoint.id,\n          'backend_restart',"),
  'backend restart recovery must continue to reuse checkpoint identity as its stable operation key',
);

process.stdout.write('checkpoint resume idempotency regression: PASS\n');
