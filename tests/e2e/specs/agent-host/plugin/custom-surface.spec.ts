import { randomUUID } from 'node:crypto';
import { readAgentGrantView } from '../../../../../packages/shared/src/agent/governance/http-codec';
import { requestAgentWorkspace } from '../../../support/agent';
import { installTestPlugin } from '../../../support/plugins';
import { requestAgentJson } from '../../../support/agent-request';
import {
	selectAgentSettingsGroup,
	selectAgentExtensionsSection,
	enableTestAgentExecution,
} from '../../../support/agent';
import { readAgentAppResponse } from '../../../../../packages/shared/src/agent/scope/http-codec';
import {
	readAgentPluginInstallationList,
	readAgentPluginDataView,
} from '../../../../../packages/shared/src/agent/plugins/http-codec';
import { agentRecord } from '../../../../../packages/shared/src/agent/http-codec';
import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../../support/auth';
import { captureFunctionalScreenshot } from '../../../support/functional-screenshots';
import { enablePluginApp, openAgentHub } from '../../../support/agent-host/plugin-fixture';

test.use({ e2eServices: ['plugins', 'provider'] });

test.use({ actionTimeout: 10_000 });

test('frontend target owns a full Custom App Surface and connects through the isolated Plugin SDK', async ({
	page,
	context,
}) => {
	const request = context.request;
	const legacySdkRequests: string[] = [];
	const sdkImportStatuses: number[] = [];
	page.on('request', (request) => {
		if (/^\/sdk\/frontend-v[123]\.mjs$/u.test(new URL(request.url()).pathname))
			legacySdkRequests.push(request.url());
	});
	page.on('response', (response) => {
		if (
			new URL(response.url()).pathname === '/sdk/frontend-v4.mjs' &&
			response.request().resourceType() === 'script'
		)
			sdkImportStatuses.push(response.status());
	});
	await loginAsInitialAdmin(request);
	await setUiLanguage(request);
	await enableTestAgentExecution(request);
	const custom = await installTestPlugin(request, 'nexus.custom-surface');
	const agent = await installTestPlugin(request, 'nexus.agent');
	const fullstack = await installTestPlugin(request, 'nexus.fullstack');
	for (const installed of [custom, agent, fullstack]) {
		await enablePluginApp(request, installed.appId);
	}
	const installations = await requestAgentJson(request, { method: 'GET', path: '/plugins/installations' }, (raw) =>
		readAgentPluginInstallationList(raw),
	);
	for (const installed of [custom, agent, fullstack]) {
		expect(installations.items).toContainEqual(installed);
	}
	const fullstackApp = await requestAgentJson(
		request,
		{ method: 'GET', path: '/apps/' + fullstack.appId },
		readAgentAppResponse,
	);
	const grantsPath = '/apps/' + fullstack.appId + '/grants';
	const grants = await requestAgentJson(request, { method: 'GET', path: grantsPath }, readAgentGrantView);
	await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: grantsPath,
			data: {
				expectedPolicyRevision: grants.policyRevision,
				grants: [{ capability: 'plugin.invoke', scope: { kind: 'global' } }],
			},
		},
		readAgentGrantView,
	);
	const thread = await requestAgentWorkspace(request, fullstackApp, {
		method: 'agent.threads.create',
		params: { operationId: randomUUID(), title: 'Backend probe', autoTitle: false },
	});
	if (thread.method !== 'agent.threads.create') throw new Error('Probe thread missing');

	const readBackendProbe = async () => {
		const started = await requestAgentWorkspace(request, fullstackApp, {
			method: 'agent.runs.create',
			params: {
				threadId: thread.value.id,
				operationId: randomUUID(),
				input: {
					approvalMode: 'full_access',
					prompt: 'Probe private backend state',
					connectionIds: [],
					inputJson: '{}',
				},
			},
		});
		if (started.method !== 'agent.runs.create') throw new Error('Probe Run missing');
		await expect
			.poll(async () => {
				const state = await requestAgentWorkspace(request, fullstackApp, {
					method: 'agent.runs.get',
					params: { runId: started.value.run.id },
				});
				return state.method === 'agent.runs.get' ? state.value?.status : null;
			})
			.toBe('completed');
		const outputs = await requestAgentWorkspace(request, fullstackApp, {
			method: 'agent.runs.outputs',
			params: { runId: started.value.run.id },
		});
		if (outputs.method !== 'agent.runs.outputs' || outputs.value?.length !== 1)
			throw new Error('Probe output missing');
		const content = await requestAgentWorkspace(request, fullstackApp, {
			method: 'agent.content.read',
			params: { runId: started.value.run.id, reference: outputs.value[0], index: 0 },
		});
		if (content.method !== 'agent.content.read') throw new Error('Probe content missing');
		expect(content.value.nextIndex).toBeNull();
		return JSON.parse(content.value.text);
	};

	const backendProbe = await readBackendProbe();
	expect(backendProbe).toMatchObject({
		appId: fullstack.appId,
		state: 'active',
		protocolVersion: 4,
		fileReadDenied: true,
		childProcessDenied: true,
	});
	expect(await readBackendProbe()).toEqual(backendProbe);
	await page.goto('/settings?tab=agent');
	await selectAgentSettingsGroup(page, 'tools');
	const section = page.getByRole('region', { name: 'Plugin management', exact: true });

	const appsSection = page.getByRole('region', { name: 'Agent apps', exact: true });
	await selectAgentExtensionsSection(page, 'market');
	await expect(section.getByRole('button', { name: 'Manage repositories', exact: true })).toBeVisible();
	await expect(section.locator('input[type="file"]')).toHaveCount(0);
	await expect(section.getByRole('button', { name: 'Choose signed package', exact: true })).toHaveCount(0);
	for (const installed of [custom, agent, fullstack]) {
		await selectAgentExtensionsSection(page, 'apps');
		const card = appsSection.locator('article[data-app-id="' + installed.appId + '"]');
		await expect(card).toBeVisible();
		await expect(card.getByText('v' + installed.version, { exact: true })).toBeVisible();
		await expect(card.getByRole('button', { name: 'Uninstall', exact: true })).toBeDisabled();
		await expect(card.getByRole('button', { name: 'Configure Policies', exact: true })).toBeVisible();
	}

	await expect(page.getByRole('heading', { name: 'Installed Agents', exact: true })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Installed plugins', exact: true })).toBeVisible();
	const policyCard = appsSection.locator('article[data-app-id="' + agent.appId + '"]');
	const policyToggle = policyCard.getByRole('button', { name: 'Configure Policies', exact: true });
	await policyToggle.click();
	await expect(policyToggle).toHaveAttribute('aria-expanded', 'true');
	await expect(policyCard.locator('section').first()).toBeVisible();
	await policyToggle.click();
	await expect(policyToggle).toHaveAttribute('aria-expanded', 'false');

	await captureFunctionalScreenshot(page, 'agent-plugins-multiple-installed.png', {
		viewport: { width: 1440, height: 900 },
	});
	await selectAgentExtensionsSection(page, 'market');
	await expect(section.getByText('Runtime observations', { exact: true })).toHaveCount(0);
	await expect(section.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
	await expect(section.getByRole('heading', { name: 'Installed and retained data', exact: true })).toHaveCount(0);
	await page.goto('/settings?tab=data');
	const maintenance = page.locator('details').filter({
		has: page.locator('summary').filter({ hasText: /^Diagnostics and recovery \(advanced\)$/ }),
	});
	await maintenance.getByText('Diagnostics and recovery (advanced)', { exact: true }).click();
	await expect(maintenance.getByText('Host diagnostics', { exact: true })).toBeVisible();
	await expect(maintenance.getByText('Machine mutation recovery', { exact: true })).toBeVisible();
	await expect(maintenance.getByText('Installation recovery and upgrade packages', { exact: true })).toHaveCount(0);
	await expect(maintenance.getByText('Runtime observations', { exact: true })).toHaveCount(0);
	await page.goto('/connections');
	const hub = await openAgentHub(page);

	const choose = async (appId: string) => {
		const app = await requestAgentJson(request, { method: 'GET', path: '/apps/' + appId }, readAgentAppResponse);
		await hub.getByRole('button', { name: 'Choose an Agent app', exact: true }).click();
		await page
			.locator('[data-agent-hub-portal]')
			.getByRole('button')
			.filter({ has: page.getByText(app.name, { exact: true }) })
			.click();
	};

	await choose(custom.appId);
	const customFrame = hub.locator('iframe').filter({ visible: true }).contentFrame();
	await expect(customFrame.getByRole('heading', { name: 'Custom Surface Fixture' })).toBeVisible();
	await expect(customFrame.getByTestId('custom-sdk-status')).toHaveText(
		`ready:${custom.appId}:nexus.custom-surface`,
		{ timeout: 15_000 },
	);
	await expect.poll(() => sdkImportStatuses.length).toBeGreaterThan(0);
	expect(sdkImportStatuses.every((status) => status === 200)).toBe(true);
	expect(legacySdkRequests).toEqual([]);
	await expect(hub.locator('iframe').filter({ visible: true })).toHaveAttribute(
		'sandbox',
		'allow-scripts allow-forms',
	);
	const formAction = 'https://form-submission.invalid/nexus-plugin-form-probe';
	let nativeRequests = 0;
	await page.route(formAction, async (route) => {
		nativeRequests += 1;
		await route.abort();
	});
	const formEvents = await customFrame.locator('body').evaluate(async (body, action) => {
		const form = document.createElement('form');
		const input = document.createElement('input');
		input.required = true;
		input.value = 'sandbox-submit-probe';
		const button = document.createElement('button');
		button.type = 'submit';
		form.append(input, button);
		body.append(form);
		let submitEvents = 0;
		form.addEventListener(
			'submit',
			(event) => {
				event.preventDefault();
				submitEvents += 1;
			},
			{ once: true },
		);
		button.click();
		if (submitEvents !== 1) {
			form.remove();
			return { submitEvents, directive: '' };
		}
		form.action = action;
		try {
			const directive = await new Promise<string>((resolve, reject) => {
				const onViolation = (event: SecurityPolicyViolationEvent) => {
					if (event.effectiveDirective !== 'form-action') return;
					if (new URL(event.blockedURI).origin !== new URL(action).origin) return;
					clearTimeout(timeout);
					document.removeEventListener('securitypolicyviolation', onViolation);
					resolve(event.effectiveDirective);
				};

				const timeout = setTimeout(() => {
					document.removeEventListener('securitypolicyviolation', onViolation);
					reject(new Error('Native plugin form submission was not blocked by form-action CSP'));
				}, 5000);
				document.addEventListener('securitypolicyviolation', onViolation);
				form.requestSubmit();
			});
			return { submitEvents, directive };
		} finally {
			form.remove();
		}
	}, formAction);
	expect(formEvents).toEqual({ submitEvents: 1, directive: 'form-action' });
	expect(nativeRequests).toBe(0);
	await page.unroute(formAction);
	await expect(customFrame.getByTestId('custom-sdk-status')).toHaveText(`ready:${custom.appId}:nexus.custom-surface`);
	await choose(fullstack.appId);
	const frame = hub.locator('iframe').filter({ visible: true });
	await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
	const surface = frame.contentFrame();
	await expect(surface.getByTestId('fullstack-frontend-status')).toHaveText(
		`frontend:ready:${fullstack.appId}@1.0.0`,
	);
	await expect(surface.getByTestId('fullstack-backend-status')).toHaveText('backend:active');
	await surface.getByTestId('fullstack-write-storage').click();
	await expect(surface.getByTestId('fullstack-storage-result')).toHaveText('storage:version:1:counter:1');
	const stored = await requestAgentJson(
		request,
		{ method: 'GET', path: `/plugins/installations/${fullstack.appId}/data/frontend.demo` },
		(raw) => {
			const row = agentRecord(raw, ['value']);
			return readAgentPluginDataView(row.value);
		},
	);
	expect(JSON.parse(stored.valueJson!)).toEqual({ source: 'frontend', counter: 1 });
	const crossed = await requestAgentJson(
		request,
		{ method: 'GET', path: `/plugins/installations/${custom.appId}/data/frontend.demo` },
		(raw) => agentRecord(raw, ['value']),
	);
	expect(crossed.value).toBeNull();
	await choose(custom.appId);
	await expect(
		hub.locator('iframe').filter({ visible: true }).contentFrame().getByTestId('custom-sdk-status'),
	).toHaveText(`ready:${custom.appId}:nexus.custom-surface`);
	expect(sdkImportStatuses.every((status) => status === 200)).toBe(true);
	expect(legacySdkRequests).toEqual([]);
});
