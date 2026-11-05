import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqliteFailure } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';
import { initializeDesktopCertificates } from '../../../packages/backend/dist/modules/remote/desktop/adapters/sqlite/certificate-schema.js';
import { SqliteCertificateTrustStorage } from '../../../packages/backend/dist/modules/remote/desktop/adapters/sqlite/certificate-sql.js';
import { DesktopModel } from '../../../packages/backend/dist/modules/remote/desktop/model/desktop-model.js';
import { DesktopService } from '../../../packages/backend/dist/modules/remote/desktop/service/desktop-service.js';
import {
	DesktopCertificateRequired,
	DesktopFailure,
} from '../../../packages/backend/dist/modules/remote/desktop/desktop-errors.js';
import { SecureSessionTokens } from '../../../packages/backend/dist/platform/security/adapters/secure-session-tokens.js';

const first = '11:'.repeat(31) + '11';
const second = '22:'.repeat(31) + '22';
const third = '33:'.repeat(31) + '33';

const approval = (fingerprint = first, previousFingerprint = null) => ({
	host: 'desktop.local',
	port: 3389,
	fingerprint,
	previousFingerprint,
	remember: true,
});

const failure = (code) => (error) => error instanceof DesktopFailure && error.code === code;

const tokens = new SecureSessionTokens();

await test('Certificate trust CAS and transaction revocation preserve the last confirmed certificate', async (t) => {
	assert.ok(process.argv[2], 'Dedicated database path required');
	const db = SqliteRuntime.open(process.argv[2]);
	t.after(() => db.close());
	await initializeDesktopCertificates(db);
	const storage = new SqliteCertificateTrustStorage(db);
	let reads = 0;
	let revokeAt = Infinity;
	storage.installTransactionIdentityReader(async () => (++reads >= revokeAt ? null : 1));
	const model = new DesktopModel({}, tokens, storage);

	const remember = (value, validate = () => undefined) => model.rememberCertificate(1, 'session', value, validate);

	await remember(approval());
	const results = await Promise.allSettled([remember(approval(second, first)), remember(approval(third, first))]);
	assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
	const rejected = results.find((result) => result.status === 'rejected');
	assert.ok(failure('conflict')(rejected.reason));
	assert.equal(await model.trustedCertificate(1, 'desktop.local', 3389), second);
	assert.equal(await model.trustedCertificate(2, 'desktop.local', 3389), null);
	assert.equal(await model.trustedCertificate(1, 'desktop.local', 3390), null);
	// Revoke on the post-write identity read: the real SQLite transaction must roll back.
	revokeAt = reads + 2;
	await assert.rejects(remember(approval(third, second)), failure('unauthenticated'));
	assert.equal(await model.trustedCertificate(1, 'desktop.local', 3389), second);
	revokeAt = Infinity;
	let admissions = 0;
	await assert.rejects(
		remember(approval(third, second), () => {
			if (++admissions === 2) throw new DesktopFailure('operation_unknown');
		}),
		failure('operation_unknown'),
	);
	assert.equal(await model.trustedCertificate(1, 'desktop.local', 3389), second);
	await remember(approval(third, second));
	assert.equal(await model.trustedCertificate(1, 'desktop.local', 3389), third);
});

await test('Uncertain SQLite outcomes remain unknown at the Desktop boundary', async () => {
	for (const kind of ['commit_unknown', 'rollback_failed']) {
		const model = new DesktopModel({}, tokens, {
			async confirm() {
				throw new SqliteFailure(kind);
			},
		});
		await assert.rejects(
			model.rememberCertificate(1, 'session', approval(), () => undefined),
			failure('operation_unknown'),
		);
	}
});

function fixture(t, beforeClose = () => undefined) {
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
	t.after(async () => {
		beforeClose();
		await owner.close();
	});

	const issue = (value = null, signal) =>
		owner.issue('session', 1, 'RDP', { width: null, height: null, dpi: null }, signal, value);

	return { owner, state, issue };
}

await test('Certificate decisions require fresh approval after rotation and distinguish system verification failures', async (t) => {
	const { state, issue } = fixture(t);

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

await test('Canceled certificate probes retain capacity until technical completion and never issue late tickets', async (t) => {
	let release;
	let entered;
	const { owner, state, issue } = fixture(t, () => release?.());
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

console.log('PASS Desktop certificate decisions, trust transactions and canceled probe ownership');
