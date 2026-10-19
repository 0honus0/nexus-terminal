import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../remote/openssh-fixture.mjs';

const requireBackend = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const requireE2e = createRequire(new URL('../../e2e/package.json', import.meta.url));
const puppeteer = requireBackend('puppeteer-core');
const { chromium } = requireE2e('@playwright/test');

await test('B10 actual CDP Browser ownership and governed operations', { timeout: 90000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-b10-browser-'));
	let sshd;
	let browser;
	let observer;
	let independent;
	let sequence = 0;
	const requests = [];
	const site = createServer((request, response) => {
		requests.push(request.url);
		response.writeHead(200, { 'Content-Type': 'text/html' });
		response.end(
			'<!doctype html><title>B10 Browser</title><h1>Untrusted fixture page</h1><button onclick="fetch(\'/allowed/effect\'); console.log(\'clicked\')">Perform effect</button><script>console.log("fixture-console")</script>',
		);
	});
	let pageOrigin;

	async function contexts(count) {
		const ids = await until(
			async () => (await observer.send('Target.getBrowserContexts')).browserContextIds,
			(value) => value.length + 1 === count,
			'Expected owned browser contexts',
		);
		assert.equal(browser.connected, true);
		assert.ok(ids.includes(independent.id));
	}

	async function scenario(name, work) {
		await t.test(name, async (scenario) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const f = await openAgentExecution(directory, sshd);
			scenario.after(async () => {
				await f.close();
				await contexts(2);
			});
			await f.grants(['browser.read', 'browser.interact', 'artifacts.read', 'artifacts.write']);
			const path = '/api/v1/agent/browser/configuration';
			const current = expectStatus(await f.api('GET', path), 200);
			const updated = expectStatus(
				await f.api('PUT', path, {
					expectedVersion: current.version,
					targets: [
						{
							id: 'fixture',
							endpoints: [
								{ url: browser.wsEndpoint(), priority: 0, allowPlaintext: true, verifyTls: true },
							],
							allowedUrlPatterns: [pageOrigin + '/allowed/*'],
						},
					],
				}),
				200,
			);
			await work(f, updated);
		});
	}

	function open(configuration) {
		return { name: 'browser_open', input: { targetId: 'fixture', expectedVersion: configuration.version } };
	}

	try {
		sshd = await openSshd(root);
		site.listen(0, '127.0.0.1');
		await once(site, 'listening');
		pageOrigin = 'http://127.0.0.1:' + site.address().port;
		browser = await puppeteer.launch({
			executablePath: chromium.executablePath(),
			headless: true,
			args: ['--no-sandbox'],
		});
		observer = await browser.target().createCDPSession();
		independent = await browser.createBrowserContext();
		await independent.newPage();
		await contexts(2);
		await scenario(
			'approved open/navigation, live snapshot/console/screenshot and final owned-context release',
			async (f, configuration) => {
				let screenshot;
				const run = await f.start('Browser read chain', async (results) => {
					if (!results.length) {
						return open(configuration);
					}
					const sessionId = results[0].sessionId;
					if (results.length === 1) {
						await contexts(3);
						return {
							name: 'browser_navigate',
							input: { sessionId, url: pageOrigin + '/allowed/page', settleMs: 50 },
						};
					}
					if (results.length === 2) {
						assert.equal(results[1].title, 'B10 Browser');
						return { name: 'browser_snapshot', input: { sessionId } };
					}
					if (results.length === 3) {
						assert.ok(results[2].nodes.some((node) => node.tag === 'BUTTON'));
						return { name: 'browser_console', input: { sessionId } };
					}
					if (results.length === 4) {
						assert.ok(JSON.stringify(results[3]).includes('fixture-console'));
						return { name: 'browser_screenshot', input: { sessionId } };
					}
					assert.equal(results[4].mediaType, 'image/png');
					assert.ok(results[4].sizeBytes > 100);
					assert.match(results[4].sha256, /^[a-f0-9]{64}$/);
					screenshot = results[4];
					return {};
				});
				await f.approve(await f.approval(run, 'browser_open'));
				const navigate = await f.approval(run, 'browser_navigate');
				assert.ok(!requests.includes('/allowed/page'));
				await f.approve(navigate);
				await f.wait(run, 'completed');
				await contexts(2);
				assert.ok(requests.includes('/allowed/page'));
				assert.ok(f.rows('agent_run_tools', run).every((row) => row.state === 'completed'));
				const downloaded = await f.api(
					'GET',
					'/api/v1/agent/apps/' + f.appId + '/artifacts/' + screenshot.artifactId + '/content',
				);
				expectStatus(downloaded, 200);
				assert.equal(downloaded.bytes.length, screenshot.sizeBytes);
				assert.equal(createHash('sha256').update(downloaded.bytes).digest('hex'), screenshot.sha256);
				assert.deepEqual(downloaded.bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
				const decoderContext = await browser.createBrowserContext();
				try {
					const page = await decoderContext.newPage();
					const dimensions = await page.evaluate(async (base64) => {
						const image = new Image();
						image.src = 'data:image/png;base64,' + base64;
						await image.decode();
						return { width: image.naturalWidth, height: image.naturalHeight };
					}, downloaded.bytes.toString('base64'));
					assert.ok(dimensions.width > 0 && dimensions.height > 0);
				} finally {
					await decoderContext.close();
				}
			},
		);
		await scenario('disallowed navigation is blocked before page request', async (f, configuration) => {
			const run = await f.start('Browser URL refusal', (results) =>
				!results.length
					? open(configuration)
					: {
							name: 'browser_navigate',
							input: { sessionId: results[0].sessionId, url: pageOrigin + '/blocked/secret' },
						},
			);
			await f.approve(await f.approval(run, 'browser_open'));
			await f.approve(await f.approval(run, 'browser_navigate'));
			await f.wait(run, 'unknown');
			assert.ok(!requests.includes('/blocked/secret'));
			await contexts(2);
		});
		await scenario(
			'click performs once and invalidates the previous snapshot before a second action',
			async (f, configuration) => {
				const before = requests.filter((url) => url === '/allowed/effect').length;
				const run = await f.start('Browser stale snapshot', (results) => {
					if (!results.length) {
						return open(configuration);
					}
					const sessionId = results[0].sessionId;
					if (results.length === 1) {
						return {
							name: 'browser_navigate',
							input: { sessionId, url: pageOrigin + '/allowed/click', settleMs: 50 },
						};
					}
					if (results.length === 2) {
						return { name: 'browser_snapshot', input: { sessionId } };
					}
					const snapshot = results[2];
					const button = snapshot.nodes.find((node) => node.tag === 'BUTTON');
					assert.ok(button);
					return {
						name: 'browser_click',
						input: { sessionId, snapshotId: snapshot.snapshotId, nodeRef: button.ref, settleMs: 50 },
					};
				});
				await f.approve(await f.approval(run, 'browser_open'));
				await f.approve(await f.approval(run, 'browser_navigate'));
				await f.approve(await f.approval(run, 'browser_click'));
				const stale = await f.approval(run, 'browser_click');
				assert.equal(requests.filter((url) => url === '/allowed/effect').length, before + 1);
				await f.approve(stale);
				await f.wait(run, 'unknown');
				assert.equal(requests.filter((url) => url === '/allowed/effect').length, before + 1);
				assert.equal(f.rows('agent_run_tools', run).at(-1).state, 'unknown');
				await contexts(2);
			},
		);
		await scenario('a second Run cannot borrow an active Browser session', async (f, configuration) => {
			let sessionId;
			const owner = await f.start('Browser original owner', (results) => {
				if (!results.length) {
					return open(configuration);
				}
				sessionId = results[0].sessionId;
				return { hold: true };
			});
			await f.approve(await f.approval(owner, 'browser_open'));
			await until(
				async () => sessionId,
				(value) => typeof value === 'string',
				'Browser session published',
			);
			const other = await f.start('Browser wrong owner', () => ({
				name: 'browser_snapshot',
				input: { sessionId },
			}));
			await f.wait(other, 'unknown');
			await contexts(3);
			await f.cancel(owner);
			await f.wait(owner, 'cancelled');
			await contexts(2);
		});
		await scenario(
			'cancelled Run releases only its context while remote browser and unrelated context survive',
			async (f, configuration) => {
				const run = await f.start('Browser cancel', (results) =>
					!results.length ? open(configuration) : { hold: true },
				);
				await f.approve(await f.approval(run, 'browser_open'));
				await contexts(3);
				await f.cancel(run);
				await f.wait(run, 'cancelled');
				await contexts(2);
				assert.equal((await independent.pages()).length, 1);
			},
		);
	} finally {
		const outcomes = await Promise.allSettled([
			Promise.resolve().then(() => browser?.close()),
			Promise.resolve().then(() => sshd?.close()),
			Promise.resolve().then(() => {
				site.closeAllConnections();
				return new Promise((resolve) => site.close(resolve));
			}),
		]);
		await rm(root, { recursive: true, force: true });
		const failures = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []));
		if (failures.length) {
			throw new AggregateError(failures, 'Browser fixtures cleanup failed');
		}
	}
});
