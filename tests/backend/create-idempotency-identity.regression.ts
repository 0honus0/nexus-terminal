import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (relativePath: string): string => readFileSync(new URL(relativePath, root), 'utf8');

const surface = read('packages/frontend/src/features/agent/host/AgentAppSurface.vue');
assert(
  surface.includes('let pendingRunCreateIdentity: { fingerprint: string; idempotencyKey: string } | null = null;'),
);
assert(surface.includes('const fingerprint = JSON.stringify(fields);'));
assert(surface.includes('pendingRunCreateIdentity = { fingerprint, idempotencyKey: crypto.randomUUID() };'));
assert(surface.includes('const created = await facade.createRun(fields, idempotencyKey);'));
assert(
  surface.includes('if (pendingRunCreateIdentity?.idempotencyKey === idempotencyKey) pendingRunCreateIdentity = null;'),
);

const agentApi = read('packages/frontend/src/features/agent/api/agent-api.ts');
assert(agentApi.includes('idempotencyKey: string,\n  ): Promise<AgentIntegrationViewDto>'));
assert(agentApi.includes("'Idempotency-Key': idempotencyKey"));

const mcp = read('packages/frontend/src/features/agent/settings/McpIntegrationSettings.vue');
assert(mcp.includes('let pendingCreateIdentity: { fingerprint: string; idempotencyKey: string } | null = null;'));
assert(mcp.includes('pendingCreateIdentity = { fingerprint, idempotencyKey: crypto.randomUUID() };'));
assert(mcp.includes('agentApi.createIntegration(DEFAULT_AGENT_APP_ID, input, pendingCreateIdentity.idempotencyKey)'));

const acp = read('packages/frontend/src/features/agent/settings/AcpRuntimeSettings.vue');
assert(
  acp.includes('let pendingIntegrationCreateIdentity: { fingerprint: string; idempotencyKey: string } | null = null;'),
);
assert(acp.includes('pendingIntegrationCreateIdentity = { fingerprint, idempotencyKey: crypto.randomUUID() };'));
assert(
  acp.includes(
    'agentApi.createIntegration(DEFAULT_AGENT_APP_ID, input, pendingIntegrationCreateIdentity.idempotencyKey)',
  ),
);

const integrationService = read('packages/backend/src/modules/agent/ai/integration.service.ts');
assert(integrationService.includes('async create(scope: Scope, raw: unknown, idempotencyKey: string)'));
assert(integrationService.includes('id: requireIdempotencyKey(idempotencyKey)'));

const integrationRepository = read(
  'packages/backend/src/infrastructure/agent/repositories/sqlite-integration.repository.ts',
);
assert(integrationRepository.includes('INSERT OR IGNORE INTO agent_integrations'));
assert(integrationRepository.includes("throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');"));
assert(integrationRepository.includes('this.cipher.decrypt(row.protected_credential)'));
assert(integrationRepository.includes('credential !== record.credential'));

const integrationRoute = read('packages/backend/src/interfaces/http/agent/app-integrations.routes.ts');
assert(integrationRoute.includes("const idempotencyKey = request.header('idempotency-key');"));
assert(integrationRoute.includes("if (!idempotencyKey) throw new Error('IDEMPOTENCY_KEY_INVALID');"));
assert(integrationRoute.includes('dependencies.integrations.create(scope, input, idempotencyKey)'));

const pluginApi = read('packages/frontend/src/features/agent/api/plugin-api.ts');
assert(pluginApi.includes('idempotencyKey: string,\n  ): Promise<AgentAppIntentReceiptDto>'));
assert(pluginApi.includes("'Idempotency-Key': idempotencyKey"));

const agentRoutes = read('packages/backend/src/interfaces/http/agent/agent.routes.ts');
const intentRoute = agentRoutes.slice(
  agentRoutes.indexOf("'/apps/:appId/plugin-intents'"),
  agentRoutes.indexOf("'/apps/:appId/execution-policy'"),
);
assert(intentRoute.includes("const idempotencyKey = request.header('idempotency-key');"));
assert(intentRoute.includes("if (!idempotencyKey) throw new Error('IDEMPOTENCY_KEY_INVALID');"));
assert(intentRoute.includes('input,\n        idempotencyKey,'));

const appIntent = read('packages/backend/src/modules/agent/host/app-intent.service.ts');
assert(appIntent.includes('const receiptId = idempotencyKey ? requireIdempotencyKey(idempotencyKey) : randomUUID();'));
assert(appIntent.includes('const existing = await this.repository.get(scope.userId, receiptId);'));
const appIntentRepository = read(
  'packages/backend/src/infrastructure/agent/repositories/sqlite-app-intent.repository.ts',
);
assert(appIntentRepository.includes('INSERT OR IGNORE INTO agent_app_intent_receipts'));

process.stdout.write('create idempotency identity regression: PASS\n');
