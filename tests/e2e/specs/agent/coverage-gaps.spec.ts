import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_URLS } from '../../support/test-env';

type Envelope<T> = { data: T; requestId: string };
type AppSummary = {
	id: string;
	stateVersion: number;
	enabled: boolean;
	health: string;
};

const repositoryUrl = `${E2E_URLS.pluginRepositoryOrigin}/catalog.json`;

const csrfToken = async (request: APIRequestContext): Promise<string> => {
	const response = await request.get('/api/v1/agent/security/csrf');
	expect(response.ok(), await response.text()).toBeTruthy();
	return ((await response.json()) as Envelope<{ token: string }>).data.token;
};

const installRecommendedAgent = async (request: APIRequestContext, csrf: string): Promise<void> => {
	const installed = await request.post('/api/v1/agent/onboarding/recommended-plugin/install', {
		headers: { 'X-Nexus-CSRF': csrf },
		data: {},
	});
	expect(installed.ok(), await installed.text()).toBeTruthy();
};

const appSummary = async (request: APIRequestContext, appId: string): Promise<AppSummary> => {
	const response = await request.get('/api/v1/agent/apps');
	expect(response.ok(), await response.text()).toBeTruthy();
	const app = ((await response.json()) as Envelope<AppSummary[]>).data.find((candidate) => candidate.id === appId);
	expect(app).toBeDefined();
	return app!;
};

const enableApp = async (request: APIRequestContext, headers: Record<string, string>, appId: string): Promise<void> => {
	const app = await appSummary(request, appId);
	if (app.enabled) return;
	const enabled = await request.patch(`/api/v1/agent/apps/${appId}`, {
		headers,
		data: { enabled: true, expectedVersion: app.stateVersion },
	});
	expect(enabled.ok(), await enabled.text()).toBeTruthy();
	await expect(enabled.json()).resolves.toMatchObject({ data: { id: appId, enabled: true, health: 'healthy' } });
};

const prepareRemoteRepository = async (request: APIRequestContext, headers: Record<string, string>) => {
	const settingsResponse = await request.get('/api/v1/agent/settings');
	expect(settingsResponse.ok(), await settingsResponse.text()).toBeTruthy();
	const settings = ((await settingsResponse.json()) as Envelope<{ revision: number }>).data;
	const patched = await request.patch('/api/v1/agent/settings', {
		headers,
		data: {
			patch: { feature: { enabled: true }, plugins: { repositories: [{ url: repositoryUrl }] } },
			expectedVersion: settings.revision,
		},
	});
	expect(patched.ok(), await patched.text()).toBeTruthy();

	const catalogResponse = await request.get('/api/v1/agent/plugins/remote/catalog', { params: { repositoryUrl } });
	expect(catalogResponse.ok(), await catalogResponse.text()).toBeTruthy();
	const catalog = (await catalogResponse.json()) as Envelope<{
		publishers: Array<{ keyId: string; label: string; publicKeyPem: string }>;
		packages: Array<{ appId: string; version: string; publisherKeyId: string }>;
	}>;
	const publisher = catalog.data.publishers[0];
	expect(publisher).toBeDefined();

	const publishersResponse = await request.get('/api/v1/agent/plugins/publishers');
	expect(publishersResponse.ok(), await publishersResponse.text()).toBeTruthy();
	const publishers = ((await publishersResponse.json()) as Envelope<Array<{ keyId: string }>>).data;
	if (!publishers.some((candidate) => candidate.keyId === publisher!.keyId)) {
		const trusted = await request.post('/api/v1/agent/plugins/publishers', {
			headers,
			data: { publicKeyPem: publisher!.publicKeyPem, label: publisher!.label },
		});
		expect(trusted.status(), await trusted.text()).toBe(201);
	}
	return catalog.data;
};

const stageRemotePlugin = async (
	request: APIRequestContext,
	headers: Record<string, string>,
	appId: string,
	version: string,
): Promise<string> => {
	const staged = await request.post('/api/v1/agent/plugins/remote/stage', {
		headers,
		data: { repositoryUrl, appId, version },
	});
	expect(staged.status(), await staged.text()).toBe(201);
	const stageId = ((await staged.json()) as Envelope<{ id: string }>).data.id;
	const verified = await request.post('/api/v1/agent/plugins/verify', { headers, data: { stageId } });
	expect(verified.ok(), await verified.text()).toBeTruthy();
	await expect(verified.json()).resolves.toMatchObject({ data: { plugin: { appId, version } } });
	return stageId;
};

const installStagedPlugin = async (
	request: APIRequestContext,
	headers: Record<string, string>,
	stageId: string,
): Promise<void> => {
	const installed = await request.post('/api/v1/agent/plugins/install', { headers, data: { stageId } });
	expect(installed.status(), await installed.text()).toBe(201);
};

const grantGlobalCapability = async (
	request: APIRequestContext,
	headers: Record<string, string>,
	appId: string,
	capability: string,
): Promise<void> => {
	const response = await request.get(`/api/v1/agent/apps/${appId}/grants`);
	expect(response.ok(), await response.text()).toBeTruthy();
	const view = (
		(await response.json()) as Envelope<{
			policyRevision: number;
			grants: Array<{ capability: string; scope: unknown; schemaVersion: number; grantedAt: number }>;
		}>
	).data;
	const current = view.grants.map((grant) => ({ capability: grant.capability, scope: grant.scope }));
	const grants = current.some((grant) => grant.capability === capability)
		? current
		: [...current, { capability, scope: { kind: 'global' } }];
	const replaced = await request.put(`/api/v1/agent/apps/${appId}/grants`, {
		headers,
		data: { grants, expectedPolicyRevision: view.policyRevision },
	});
	expect(replaced.ok(), await replaced.text()).toBeTruthy();
};

test('Hard Limit preview and confirm commit exactly once through the public Agent API', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const csrf = await csrfToken(request);
	const headers = { 'X-Nexus-CSRF': csrf };

	const beforeResponse = await request.get('/api/v1/agent/settings');
	expect(beforeResponse.ok(), await beforeResponse.text()).toBeTruthy();
	const before = (
		(await beforeResponse.json()) as Envelope<{
			revision: number;
			hardLimits: { maxModelRequests: number };
		}>
	).data;

	const proposedMaxRunSteps = before.hardLimits.maxModelRequests + 1;
	const previewResponse = await request.post('/api/v1/agent/settings/hard-limits/preview', {
		headers,
		data: {
			proposed: { maxModelRequests: proposedMaxRunSteps },
			expectedVersion: before.revision,
		},
	});
	expect(previewResponse.ok(), await previewResponse.text()).toBeTruthy();
	const preview = (
		(await previewResponse.json()) as Envelope<{
			confirmationId: string;
			expectedVersion: number;
			current: { maxModelRequests: number };
			proposed: { maxModelRequests: number };
			impact: {
				changes: Array<{ key: string; current: number; proposed: number; direction: string }>;
				hasIncrease: boolean;
			};
			expiresAt: number;
		}>
	).data;
	expect(preview).toMatchObject({
		expectedVersion: before.revision,
		current: { maxModelRequests: before.hardLimits.maxModelRequests },
		proposed: { maxModelRequests: proposedMaxRunSteps },
		impact: {
			hasIncrease: true,
			changes: [
				{
					key: 'maxModelRequests',
					current: before.hardLimits.maxModelRequests,
					proposed: proposedMaxRunSteps,
					direction: 'increase',
				},
			],
		},
	});
	expect(preview.confirmationId).toBeTruthy();
	expect(preview.expiresAt).toBeGreaterThan(0);

	const confirmedResponse = await request.post('/api/v1/agent/settings/hard-limits/confirm', {
		headers,
		data: { confirmationId: preview.confirmationId, expectedVersion: before.revision },
	});
	expect(confirmedResponse.ok(), await confirmedResponse.text()).toBeTruthy();
	const confirmed = (
		(await confirmedResponse.json()) as Envelope<{
			revision: number;
			hardLimits: { maxModelRequests: number };
		}>
	).data;
	expect(confirmed.revision).toBe(before.revision + 1);
	expect(confirmed.hardLimits.maxModelRequests).toBe(proposedMaxRunSteps);

	const replay = await request.post('/api/v1/agent/settings/hard-limits/confirm', {
		headers,
		data: { confirmationId: preview.confirmationId, expectedVersion: before.revision },
	});
	expect(replay.status(), await replay.text()).toBe(404);
	await expect(replay.json()).resolves.toMatchObject({ error: { code: 'HARD_LIMIT_CONFIRMATION_NOT_FOUND' } });
});

test('per-App execution policy persists overrides and rejects stale or over-limit writes', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const csrf = await csrfToken(request);
	const headers = { 'X-Nexus-CSRF': csrf };
	await installRecommendedAgent(request, csrf);

	const settingsResponse = await request.get('/api/v1/agent/settings');
	expect(settingsResponse.ok(), await settingsResponse.text()).toBeTruthy();
	const settings = (
		(await settingsResponse.json()) as Envelope<{
			hardLimits: { maxModelRequests: number };
		}>
	).data;

	const beforeResponse = await request.get('/api/v1/agent/apps/nexus.agent/execution-policy');
	expect(beforeResponse.ok(), await beforeResponse.text()).toBeTruthy();
	const before = (
		(await beforeResponse.json()) as Envelope<{
			version: number;
			overrides: Record<string, unknown>;
			effective: { maxModelRequests: number; contextCompactionMode: string; contextProfile: string };
		}>
	).data;
	expect(before.version).toBe(0);
	expect(before.overrides).toEqual({});

	const savedResponse = await request.put('/api/v1/agent/apps/nexus.agent/execution-policy', {
		headers,
		data: {
			overrides: {
				maxModelRequests: Math.min(3, settings.hardLimits.maxModelRequests),
				contextCompactionMode: 'aggressive',
				contextProfile: 'extended',
			},
			expectedVersion: before.version,
		},
	});
	expect(savedResponse.ok(), await savedResponse.text()).toBeTruthy();
	const saved = (
		(await savedResponse.json()) as Envelope<{
			version: number;
			overrides: { maxModelRequests: number; contextCompactionMode: string; contextProfile: string };
			effective: { maxModelRequests: number; contextCompactionMode: string; contextProfile: string };
		}>
	).data;
	expect(saved.version).toBe(1);
	expect(saved.overrides).toMatchObject({
		maxModelRequests: Math.min(3, settings.hardLimits.maxModelRequests),
		contextCompactionMode: 'aggressive',
		contextProfile: 'extended',
	});
	expect(saved.effective).toMatchObject(saved.overrides);

	const stale = await request.put('/api/v1/agent/apps/nexus.agent/execution-policy', {
		headers,
		data: { overrides: {}, expectedVersion: before.version },
	});
	expect(stale.status(), await stale.text()).toBe(409);
	await expect(stale.json()).resolves.toMatchObject({ error: { code: 'SETTINGS_VERSION_CONFLICT' } });

	const overLimit = await request.put('/api/v1/agent/apps/nexus.agent/execution-policy', {
		headers,
		data: {
			overrides: { maxModelRequests: settings.hardLimits.maxModelRequests + 1 },
			expectedVersion: saved.version,
		},
	});
	expect(overLimit.status(), await overLimit.text()).toBe(422);
	await expect(overLimit.json()).resolves.toMatchObject({ error: { code: 'BUDGET_HARD_LIMIT_EXCEEDED' } });

	const persistedResponse = await request.get('/api/v1/agent/apps/nexus.agent/execution-policy');
	expect(persistedResponse.ok(), await persistedResponse.text()).toBeTruthy();
	await expect(persistedResponse.json()).resolves.toMatchObject({
		data: {
			version: saved.version,
			overrides: saved.overrides,
			effective: saved.effective,
		},
	});
});

test('Memory proposal, review, list, stale-CAS rejection, and revoke close the public lifecycle', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const csrf = await csrfToken(request);
	const headers = { 'X-Nexus-CSRF': csrf };
	await installRecommendedAgent(request, csrf);

	const proposedResponse = await request.post('/api/v1/apps/nexus.agent/memories/proposals', {
		headers,
		data: {
			content: 'E2E candidate memory',
			sourceRefs: { kind: 'e2e', case: 'public-memory-lifecycle' },
			confidence: 0.9,
			expiresAt: null,
		},
	});
	expect(proposedResponse.status(), await proposedResponse.text()).toBe(201);
	const proposed = (
		(await proposedResponse.json()) as Envelope<{
			id: string;
			content: string;
			status: string;
			confidence: number;
			version: number;
		}>
	).data;
	expect(proposed).toMatchObject({
		content: 'E2E candidate memory',
		status: 'candidate',
		confidence: 0.9,
		version: 1,
	});

	const candidates = await request.get('/api/v1/apps/nexus.agent/memories', {
		params: { status: 'candidate', limit: 20 },
	});
	expect(candidates.ok(), await candidates.text()).toBeTruthy();
	await expect(candidates.json()).resolves.toMatchObject({
		data: { items: [expect.objectContaining({ id: proposed.id, status: 'candidate' })] },
	});

	const publishedResponse = await request.post(`/api/v1/apps/nexus.agent/memories/${proposed.id}/review`, {
		headers,
		data: {
			decision: 'publish',
			expectedVersion: proposed.version,
			content: 'E2E published memory',
		},
	});
	expect(publishedResponse.ok(), await publishedResponse.text()).toBeTruthy();
	const published = (
		(await publishedResponse.json()) as Envelope<{
			id: string;
			content: string;
			status: string;
			version: number;
		}>
	).data;
	expect(published).toMatchObject({ id: proposed.id, content: 'E2E published memory', status: 'published' });
	expect(published.version).toBe(proposed.version + 1);

	const staleReview = await request.post(`/api/v1/apps/nexus.agent/memories/${proposed.id}/review`, {
		headers,
		data: { decision: 'revoke', expectedVersion: proposed.version },
	});
	expect(staleReview.status(), await staleReview.text()).toBe(409);

	const publishedList = await request.get('/api/v1/apps/nexus.agent/memories', {
		params: { status: 'published', limit: 20 },
	});
	expect(publishedList.ok(), await publishedList.text()).toBeTruthy();
	await expect(publishedList.json()).resolves.toMatchObject({
		data: {
			items: [expect.objectContaining({ id: proposed.id, content: 'E2E published memory', status: 'published' })],
		},
	});

	const revokedResponse = await request.post(`/api/v1/apps/nexus.agent/memories/${proposed.id}/review`, {
		headers,
		data: { decision: 'revoke', expectedVersion: published.version },
	});
	expect(revokedResponse.ok(), await revokedResponse.text()).toBeTruthy();
	const revoked = ((await revokedResponse.json()) as Envelope<{ id: string; status: string; version: number }>).data;
	expect(revoked).toMatchObject({ id: proposed.id, status: 'revoked', version: published.version + 1 });

	const revokedList = await request.get('/api/v1/apps/nexus.agent/memories', {
		params: { status: 'revoked', limit: 20 },
	});
	expect(revokedList.ok(), await revokedList.text()).toBeTruthy();
	await expect(revokedList.json()).resolves.toMatchObject({
		data: { items: [expect.objectContaining({ id: proposed.id, status: 'revoked' })] },
	});
});

test('AppIntent public API creates, replays, lists, and revokes a confirmed cross-App receipt', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const csrf = await csrfToken(request);
	const headers = { 'X-Nexus-CSRF': csrf };
	await installRecommendedAgent(request, csrf);
	await prepareRemoteRepository(request, headers);

	const peerStageId = await stageRemotePlugin(request, headers, 'nexus.intent-peer', '1.0.0');
	await installStagedPlugin(request, headers, peerStageId);
	await enableApp(request, headers, 'nexus.agent');
	await enableApp(request, headers, 'nexus.intent-peer');
	await grantGlobalCapability(request, headers, 'nexus.agent', 'app.intents.exchange');
	await grantGlobalCapability(request, headers, 'nexus.intent-peer', 'app.intents.exchange');

	const idempotencyKey = randomUUID();
	const createRequest = {
		receiverAppId: 'nexus.intent-peer',
		intentId: 'e2e.receive',
		input: { source: 'e2e', entries: 2 },
		artifactRefs: [],
		confirmed: true,
	};
	const created = await request.post('/api/v1/agent/apps/nexus.agent/plugin-intents', {
		headers: { ...headers, 'Idempotency-Key': idempotencyKey },
		data: createRequest,
	});
	expect(created.status(), await created.text()).toBe(201);
	const receipt = (
		(await created.json()) as Envelope<{
			id: string;
			senderAppId: string;
			receiverAppId: string;
			intentId: string;
			schemaVersion: number;
			input: unknown;
		}>
	).data;
	expect(receipt).toMatchObject({
		senderAppId: 'nexus.agent',
		receiverAppId: 'nexus.intent-peer',
		intentId: 'e2e.receive',
		schemaVersion: 1,
		input: createRequest.input,
	});

	const replay = await request.post('/api/v1/agent/apps/nexus.agent/plugin-intents', {
		headers: { ...headers, 'Idempotency-Key': idempotencyKey },
		data: createRequest,
	});
	expect(replay.status(), await replay.text()).toBe(201);
	await expect(replay.json()).resolves.toMatchObject({ data: { id: receipt.id } });

	const received = await request.get('/api/v1/agent/apps/nexus.intent-peer/plugin-intents', {
		params: { limit: 10 },
	});
	expect(received.ok(), await received.text()).toBeTruthy();
	await expect(received.json()).resolves.toMatchObject({
		data: [expect.objectContaining({ id: receipt.id, senderAppId: 'nexus.agent', intentId: 'e2e.receive' })],
	});

	const revoked = await request.delete(`/api/v1/agent/apps/nexus.agent/plugin-intents/${receipt.id}`, { headers });
	expect(revoked.ok(), await revoked.text()).toBeTruthy();
	await expect(revoked.json()).resolves.toMatchObject({ data: { revoked: true } });

	const afterRevoke = await request.get('/api/v1/agent/apps/nexus.intent-peer/plugin-intents');
	expect(afterRevoke.ok(), await afterRevoke.text()).toBeTruthy();
	await expect(afterRevoke.json()).resolves.toMatchObject({ data: [] });
});

test('Plugin public API upgrades an installed package to a newer signed version', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const csrf = await csrfToken(request);
	const headers = { 'X-Nexus-CSRF': csrf };
	const catalog = await prepareRemoteRepository(request, headers);
	expect(catalog.packages).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ appId: 'nexus.upgrade', version: '1.0.0' }),
			expect.objectContaining({ appId: 'nexus.upgrade', version: '2.0.0' }),
		]),
	);

	const v1StageId = await stageRemotePlugin(request, headers, 'nexus.upgrade', '1.0.0');
	await installStagedPlugin(request, headers, v1StageId);
	const before = await appSummary(request, 'nexus.upgrade');

	const v2StageId = await stageRemotePlugin(request, headers, 'nexus.upgrade', '2.0.0');
	const upgraded = await request.post('/api/v1/agent/plugins/nexus.upgrade/upgrade', {
		headers,
		data: { stageId: v2StageId, expectedVersion: before.stateVersion },
	});
	expect(upgraded.status(), await upgraded.text()).toBe(200);
	await expect(upgraded.json()).resolves.toMatchObject({
		data: {
			state: 'completed',
			targetVersion: '2.0.0',
			app: { appId: 'nexus.upgrade', activeVersion: '2.0.0', acceptNewRuns: true },
			plugin: { appId: 'nexus.upgrade', version: '2.0.0', status: 'installed' },
		},
	});

	const pending = await request.get('/api/v1/agent/plugins/pending-upgrades');
	expect(pending.ok(), await pending.text()).toBeTruthy();
	await expect(pending.json()).resolves.toMatchObject({ data: [] });

	const installations = await request.get('/api/v1/agent/plugins/installations');
	expect(installations.ok(), await installations.text()).toBeTruthy();
	await expect(installations.json()).resolves.toMatchObject({
		data: expect.arrayContaining([
			expect.objectContaining({ appId: 'nexus.upgrade', version: '2.0.0', status: 'installed' }),
		]),
	});
});
