import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { DesktopModel } from '../../../../../packages/backend/src/modules/remote/desktop/model/desktop-model.ts';
import { DesktopService } from '../../../../../packages/backend/src/modules/remote/desktop/service/desktop-service.ts';
import {
	DesktopCertificateRequired,
	DesktopFailure,
} from '../../../../../packages/backend/src/modules/remote/desktop/desktop-errors.ts';
import { SecureSessionTokens } from '../../../../../packages/backend/src/platform/security/adapters/secure-session-tokens.ts';

const first = '11:'.repeat(31) + '11';
const second = '22:'.repeat(31) + '22';

const approval = (fingerprint = first, previousFingerprint = null) => ({
	host: 'desktop.local',
	port: 3389,
	fingerprint,
	previousFingerprint,
	remember: true,
});

const failure = (code) => (error) => error instanceof DesktopFailure && error.code === code;

const tokens = new SecureSessionTokens();

function fixture(beforeClose = () => undefined) {
	const state = {
		certificate: {
			fingerprint: first,
			subject: 'CN=desktop.local',
			issuer: 'CN=controlled',
			validFrom: 0,
			validTo: 8_000_000_000_000,
			systemTrusted: false,
			hostMatches: true,
		},
		trusted: null,
		probe: null,
		writes: 0,
		issued: 0,
	};
	const model = new DesktopModel(
		{
			async probeCertificate(_host, _port, signal) {
				await state.probe?.(signal);
				return state.certificate;
			},
		},
		{
			issue() {
				state.issued++;
				return tokens.issue();
			},

			digest: (value) => tokens.digest(value),
		},
		{
			async get() {
				return state.trusted === null ? null : { fingerprint: state.trusted };
			},

			async confirm(command, _digest, admit) {
				admit(1);
				state.writes++;
				state.trusted = command.fingerprint;
			},
		},
	);
	const owner = new DesktopService(
		{ authenticate: async () => ({ userId: 1 }) },
		{
			async get() {
				return {
					id: 1,
					version: 1,
					createdAt: 1,
					protocol: 'RDP',
					host: 'Desktop.Local',
					port: 3389,
					username: 'isolated-user',
					password: 'isolated-password',
				};
			},
		},
		model,
		{ async recordConnected() {} },
	);
	onTestFinished(async () => {
		beforeClose();
		await owner.close();
	});

	const issue = (value = null, signal) =>
		owner.issue('session', 1, 'RDP', { width: null, height: null, dpi: null }, signal, value);

	return { owner, state, issue };
}

test('Certificate decisions require fresh approval after rotation and distinguish system verification failures', async () => {
	const { state, issue } = fixture();

	const challenge = (reason) => (error) =>
		error instanceof DesktopCertificateRequired && error.certificate.reason === reason;

	await assert.rejects(issue(), challenge('untrusted'));
	await issue({ ...approval(), remember: false });
	assert.equal(state.writes, 0);
	await assert.rejects(issue(), challenge('untrusted'));
	state.certificate.hostMatches = false;
	await assert.rejects(issue(), challenge('hostname_mismatch'));
	state.certificate.validTo = 1;
	await assert.rejects(issue(), challenge('expired'));
	state.certificate.validTo = 8_000_000_000_000;
	state.certificate.hostMatches = true;
	state.certificate.systemTrusted = true;
	await issue();
	await issue(approval());
	assert.equal(state.writes, 1);
	state.certificate.fingerprint = second;
	// Even a system-trusted replacement cannot silently replace an explicitly pinned certificate.
	await assert.rejects(issue(), challenge('changed'));
	await assert.rejects(issue(approval()), challenge('changed'));
	assert.equal(state.writes, 1);
	await issue(approval(second, first));
	assert.equal(state.trusted, second);
	await issue();
});

test('Canceled certificate probes retain capacity until technical completion and never issue late tickets', async () => {
	let release;
	let entered;
	const { owner, state, issue } = fixture(() => release?.());
	const waiting = new Promise((resolve) => {
		release = resolve;
	});
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	let probes = 0;
	state.probe = async () => {
		if (++probes === 16) entered();
		await waiting;
	};
	const cancellation = new AbortController();
	const tasks = Array.from({ length: 16 }, () => issue(null, cancellation.signal));
	const completed = Promise.allSettled(tasks);
	await started;
	cancellation.abort();
	const results = await completed;
	assert.ok(results.every((result) => result.status === 'rejected' && failure('remote_unavailable')(result.reason)));
	await assert.rejects(issue(), failure('limit_exceeded'));
	assert.equal(state.issued, 0);
	release();
	// close() drains original tasks, rather than only the canceled HTTP waiters.
	await owner.close();
	assert.equal(state.issued, 0);
	assert.equal(state.writes, 0);
});
