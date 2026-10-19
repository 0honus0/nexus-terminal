import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Load the built entry; static API types come from its source, not generated JavaScript.
const applicationEntry = '../../../packages/backend/dist/bootstrap/create-app.js';
const { createApp } = await import(applicationEntry);

/** @param {string} name */
function required(name) {
	const value = process.env[name];
	if (!value) throw new Error(name + ' is required');
	return value;
}

/** @param {string} name */
function port(name) {
	const value = Number(required(name));
	if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Invalid ' + name);
	return value;
}

/** @type {typeof import('../../../packages/backend/src/bootstrap/create-app.js').createApp} */
const createTestApplication = createApp;

const backendPort = port('NEXUS_E2E_BACKEND_PORT');
const controlPort = port('NEXUS_E2E_BACKEND_CONTROL_PORT');
const publicOrigin = required('NEXUS_PUBLIC_ORIGIN');
const controlToken = required('NEXUS_E2E_CONTROL_TOKEN');
const dataRoot = resolve(required('NEXUS_E2E_DATA_ROOT'));
/** @type {import('../../../packages/backend/src/bootstrap/create-app.js').BackendApplication | null} */
let application = null;
let encryptionKey = randomBytes(32);
/** @type {string | null} */
let directory = null;
/** @type {Promise<void> | null} */
let resetting = null;
/** @type {Promise<void> | null} */
let shutdown = null;
let failed = false;

/**
 * Keep technical locations and finite codes, never exception messages or arbitrary properties.
 * @param {unknown} cause
 * @param {number} depth
 * @returns {object}
 */
function failureEvidence(cause, depth = 0) {
	if (!(cause instanceof Error)) return { name: 'NonError' };
	const evidence = {
		name: cause.name,
		code:
			'code' in cause && typeof cause.code === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(cause.code)
				? cause.code
				: undefined,
		frames: cause.stack
			?.split('\n')
			.filter((line) => /^\s+at /.test(line))
			.slice(0, 6),
	};
	if (depth >= 6) return evidence;
	return {
		...evidence,
		causes:
			cause instanceof AggregateError
				? cause.errors.slice(0, 12).map((error) => failureEvidence(error, depth + 1))
				: cause.cause === undefined
					? []
					: [failureEvidence(cause.cause, depth + 1)],
	};
}

async function closeApplication() {
	if (application) {
		// Failed cleanup keeps the owner and its files; a new baseline must not hide it.
		await application.close();
		application = null;
	}
	if (directory) {
		await rm(directory, { recursive: true, force: true });
		directory = null;
	}
}

/** @param {'seed' | 'empty'} mode */
async function resetApplication(mode) {
	await closeApplication();
	if (shutdown) return;
	await mkdir(dataRoot, { recursive: true });
	directory = await mkdtemp(join(dataRoot, 'backend-'));
	encryptionKey = randomBytes(32);
	await openApplication();
	if (mode === 'seed') {
		const response = await fetch('http://127.0.0.1:' + backendPort + '/api/v1/auth/setup', {
			method: 'POST',
			// This loopback request represents the trusted frontend proxy. Fetch may
			// discard Host overrides; use the proxy header consumed by the real ingress.
			headers: {
				'Content-Type': 'application/json',
				'X-Forwarded-Host': new URL(publicOrigin).host,
				Origin: publicOrigin,
			},
			body: JSON.stringify({
				username: required('NEXUS_E2E_ADMIN_USERNAME'),
				password: required('NEXUS_E2E_ADMIN_PASSWORD'),
				confirmPassword: required('NEXUS_E2E_ADMIN_PASSWORD'),
			}),
			signal: AbortSignal.timeout(30_000),
		});
		await response.arrayBuffer();
		if (response.status !== 201) throw new Error('Backend-next seed setup returned HTTP ' + response.status);
	}
}

async function openApplication() {
	if (!directory) throw new Error('E2E data directory missing');
	application = await createTestApplication(join(directory, 'nexus-terminal.db'), {
		encryptionKey,
		guacd: { host: '127.0.0.1', port: port('GUACD_PORT') },

		configuration: () => ({
			ipWhitelist: '',
			ipBlacklistEnabled: true,
			maxLoginAttempts: 5,
			loginBanDuration: 300,
			statusMonitorIntervalSeconds: 3,
			remoteHostRefreshIntervalSeconds: 30,
			passkeys: [{ origin: publicOrigin, rpId: new URL(publicOrigin).hostname }],
			captcha: {
				enabled: false,
				provider: 'none',
				siteKey: '',
				secretKey: '',
				expectedHostname: new URL(publicOrigin).hostname,
			},
		}),
	});
	await application.listenHttp({
		bindHost: '127.0.0.1',
		port: backendPort,
		publicOrigin,
		trustedProxies: ['loopback'],
	});
}

async function restartApplication() {
	if (!application || !directory) throw new Error('E2E application unavailable');
	await application.close();
	application = null;
	if (!shutdown) await openApplication();
}

/** @param {'seed' | 'empty' | 'restart'} mode */
function startReset(mode) {
	const task = mode === 'restart' ? restartApplication() : resetApplication(mode);
	resetting = task;
	void task.then(
		() => {
			if (resetting === task) resetting = null;
		},
		() => {
			failed = true;
			if (resetting === task) resetting = null;
		},
	);
	return task;
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<'seed' | 'empty' | 'restart' | null>}
 */
async function resetMode(request) {
	let body = '';
	for await (const chunk of request) {
		body += chunk.toString('utf8');
		if (Buffer.byteLength(body) > 1024) return null;
	}
	let value;
	try {
		value = JSON.parse(body);
	} catch {
		return null;
	}
	if (
		value === null ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length !== 1 ||
		(value.mode !== 'empty' && value.mode !== 'seed' && value.mode !== 'restart')
	)
		return null;
	return value.mode;
}

const control = createServer((request, response) => {
	void handleControl(request, response).catch((cause) => {
		failed = true;
		process.stderr.write('E2E baseline failed: ' + JSON.stringify(failureEvidence(cause)) + '\n');
		if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ code: 'baseline_failed' }));
	});
});

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function handleControl(request, response) {
	if (request.url === '/health' && request.method === 'GET') {
		response.writeHead(shutdown || failed || resetting ? 503 : 200).end();
		return;
	}
	if (
		(request.url !== '/reset' && request.url !== '/restart') ||
		request.method !== 'POST' ||
		request.headers['x-nexus-e2e-control'] !== controlToken ||
		request.headers.origin !== undefined
	) {
		response.writeHead(403).end();
		return;
	}
	if (shutdown || failed || resetting) {
		response.writeHead(503).end();
		return;
	}
	const mode = await resetMode(request);
	if (request.url === '/restart' && mode !== 'restart') {
		response.writeHead(400).end();
		return;
	}
	if (request.url === '/reset' && mode === 'restart') {
		response.writeHead(400).end();
		return;
	}
	if (mode === null) {
		response.writeHead(400).end();
		return;
	}
	// Recheck after reading: concurrent requests cannot both replace the baseline.
	if (shutdown || failed || resetting) {
		response.writeHead(503).end();
		return;
	}
	await startReset(mode);
	response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ reset: true, mode }));
}

function stop() {
	if (shutdown) return shutdown;
	shutdown = Promise.resolve().then(async () => {
		const results = await Promise.allSettled([
			new Promise((resolveClose, reject) =>
				control.close((cause) => (cause ? reject(cause) : resolveClose(undefined))),
			),
			Promise.resolve().then(async () => {
				if (resetting) await resetting;
			}),
		]);
		try {
			await closeApplication();
		} catch (cause) {
			results.push({ status: 'rejected', reason: cause });
		}
		const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
		if (failures.length) throw new AggregateError(failures, 'E2E backend shutdown failed');
	});
	return shutdown;
}

function handleSignal() {
	void stop().catch((cause) => {
		process.exitCode = 1;
		process.stderr.write('E2E shutdown failed: ' + JSON.stringify(failureEvidence(cause)) + '\n');
	});
}

try {
	await startReset('seed');
	await new Promise((resolveListen, reject) => {
		control.once('error', reject);
		control.listen(controlPort, '127.0.0.1', () => {
			control.off('error', reject);
			resolveListen(undefined);
		});
	});
	process.once('SIGTERM', handleSignal);
	process.once('SIGINT', handleSignal);
} catch (cause) {
	try {
		await closeApplication();
	} catch (cleanup) {
		throw new AggregateError([cause, cleanup], 'E2E startup and cleanup failed');
	}
	throw cause;
}
