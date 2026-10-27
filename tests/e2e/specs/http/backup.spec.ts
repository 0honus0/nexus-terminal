import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, getUiPreferences, loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import { createTestSshConnection, trustTestSshHostKey } from '../../support/ssh';
import { readConnectionList, readConnectionView } from '../../../../packages/shared/src/targets/connections/http-codec';
import { readBackupError, readBackupImportResponse } from '../../../../packages/shared/src/system/backups/http-codec';
import { installTestPlugin } from '../../support/plugins';
import { BACKUP_MAX_SNAPSHOT_BYTES } from '../../../../packages/shared/src/system/backups/values';
import { SealedBytes } from '../../../../packages/backend/src/platform/security/sealed-bytes';
import { E2E_URLS } from '../../support/test-env';
import { slowStep, step } from '../../support/steps';

const BACKUP_CONNECTION_NAME = 'E2E Backup SSH';
const headers = { Origin: E2E_URLS.frontendOrigin };

test('full backup restores settings and connection data', async ({ request }) => {
	await loginAsInitialAdmin(request);
	await trustTestSshHostKey(request);
	let backup = Buffer.alloc(0);
	let connectionId = 0;
	await step('prepare data that must survive backup and restore', async () => {
		const response = await request.get('/api/v1/targets/connections');
		expect(response.ok()).toBeTruthy();
		for (const connection of readConnectionList(await response.json())) {
			if (connection.name === BACKUP_CONNECTION_NAME) {
				expect(
					(await request.delete('/api/v1/targets/connections/' + connection.id, { headers })).ok(),
				).toBeTruthy();
			}
		}
		connectionId = await createTestSshConnection(request, BACKUP_CONNECTION_NAME);
		await updateUiPreferences(request, (preferences) => {
			preferences.showPopupFileManager = true;
		});
	});

	await slowStep('export an encrypted full backup', async () => {
		const response = await request.post('/api/v1/settings/backup/export', {
			headers,
			data: { password: E2E_ADMIN.password },
		});
		expect(response.status()).toBe(200);
		expect(response.headers()['content-disposition']).toContain('.nexus-backup');
		backup = Buffer.from(await response.body());
		expect(backup.length).toBeGreaterThan(100);
		expect(backup.subarray(0, 10).toString('ascii')).toBe('NXSEALED2\n');
		expect(backup.toString('utf8')).not.toContain('e2e-password');
		expect(backup.toString('utf8')).not.toContain(BACKUP_CONNECTION_NAME);
	});

	await slowStep('a foreign-instance backup rejects a wrong password without changing live data', async () => {
		// Re-seal the real snapshot without this instance's wrapping key, exercising the
		// cross-instance password path rather than corrupting authenticated envelope bytes.
		const codec = new SealedBytes(BACKUP_MAX_SNAPSHOT_BYTES, null);
		const snapshot = await codec.decode(backup, E2E_ADMIN.password);
		let foreign: Uint8Array;
		try {
			foreign = await codec.encode(snapshot, E2E_ADMIN.password);
		} finally {
			snapshot.fill(0);
		}
		try {
			const response = await request.post('/api/v1/settings/backup/import', {
				headers,
				multipart: {
					password: 'definitely-not-the-password',
					backupFile: {
						name: 'foreign.nexus-backup',
						mimeType: 'application/octet-stream',
						buffer: Buffer.from(foreign),
					},
				},
			});
			expect(response.status()).toBe(401);
			expect(readBackupError(await response.json()).code).toBe('invalid_password');
			const current = await request.get('/api/v1/targets/connections/' + connectionId);
			expect(current.status()).toBe(200);
			expect(readConnectionView(await current.json()).name).toBe(BACKUP_CONNECTION_NAME);
		} finally {
			foreign.fill(0);
		}
	});

	await step('destroy the backed up data', async () => {
		expect((await request.delete('/api/v1/targets/connections/' + connectionId, { headers })).ok()).toBeTruthy();
		await updateUiPreferences(request, (preferences) => {
			preferences.showPopupFileManager = false;
		});
	});

	await slowStep('import the backup and restore the data', async () => {
		const response = await request.post('/api/v1/settings/backup/import', {
			headers,
			multipart: {
				password: E2E_ADMIN.password,
				backupFile: {
					name: 'e2e.nexus-backup',
					mimeType: 'application/octet-stream',
					buffer: backup,
				},
			},
		});
		expect(response.status()).toBe(200);
		const receipt = readBackupImportResponse(await response.json());
		expect(receipt.restoredTables).toBeGreaterThan(0);
		expect(receipt.restoredRows).toBeGreaterThan(0);
		expect(receipt.cleanupPending).toBe(false);
	});

	await slowStep('verify preferences and encrypted connection credentials survived restore', async () => {
		expect((await getUiPreferences(request)).preferences.showPopupFileManager).toBe(true);
		const response = await request.get('/api/v1/targets/connections/' + connectionId);
		expect(response.status()).toBe(200);
		expect(readConnectionView(await response.json()).name).toBe(BACKUP_CONNECTION_NAME);
		const connectionTest = await request.post('/api/v1/targets/connections/' + connectionId + '/test', { headers });
		expect(connectionTest.status()).toBe(200);
		await expect(connectionTest.json()).resolves.toMatchObject({ status: 'ok' });
	});

	await slowStep('verify signed Agent plugin installation still works after full backup restore', async () => {
		expect((await installTestPlugin(request, 'nexus.agent')).definitionId).toBe('nexus.agent');
	});
});
