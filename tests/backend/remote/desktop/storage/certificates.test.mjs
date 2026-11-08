// Exercise the real SQLite Worker from the existing Backend build; source-only transforms cannot load its worker.js.
import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqliteFailure } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';
import { initializeDesktopCertificates } from '../../../../../packages/backend/dist/modules/remote/desktop/adapters/sqlite/certificate-schema.js';
import { SqliteCertificateTrustStorage } from '../../../../../packages/backend/dist/modules/remote/desktop/adapters/sqlite/certificate-sql.js';
import { DesktopModel } from '../../../../../packages/backend/dist/modules/remote/desktop/model/desktop-model.js';
import { DesktopFailure } from '../../../../../packages/backend/dist/modules/remote/desktop/desktop-errors.js';
import { SecureSessionTokens } from '../../../../../packages/backend/dist/platform/security/adapters/secure-session-tokens.js';

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

test('Certificate trust CAS and transaction revocation preserve the last confirmed certificate', async () => {
	const db = SqliteRuntime.openMemory();
	onTestFinished(() => db.close());
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

test('Uncertain SQLite outcomes remain unknown at the Desktop boundary', async () => {
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
