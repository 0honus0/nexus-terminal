// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { openBackup } from '../support/fixture.mjs';
import { presentationApi } from '../../../../packages/frontend/src/features/preferences/api/presentation-api.ts';
import { BackupRequestFailure } from '../../../../packages/frontend/src/features/backup/model/backup-types.ts';

// The API uses the platform's native File/Blob/FormData and Request here. Native
// downloads, multipart form selection, app-wide inertness and reload stay in Playwright.
test('a real restored database with a lost receipt remains unknown, refuses replay and survives identity reset', async () => {
	vi.stubGlobal('window', { location: { href: 'http://localhost/', origin: 'http://localhost' } });
	const { app, store, password } = await openBackup();
	const response = await app.fetch('/api/v1/settings/backup/export', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ password }),
	});
	expect(response.status).toBe(200);
	const bytes = new Uint8Array(await response.arrayBuffer());
	expect(bytes.length).toBeGreaterThan(32);
	expect(new TextDecoder().decode(bytes.subarray(0, 10))).toBe('NXSEALED2\n');
	const initial = await presentationApi.load();
	await presentationApi.update({
		action: 'preferences',
		expectedVersion: initial.version,
		preferences: { ...initial.preferences, timezone: 'Europe/London' },
	});
	let imports = 0;
	vi.stubGlobal('fetch', async (request, input) => {
		const result = await app.fetch(request, input);
		if (
			new URL(request instanceof Request ? request.url : request, 'http://localhost').pathname ===
			'/api/v1/settings/backup/import'
		) {
			imports++;
			expect(result.status).toBe(200);
			throw new TypeError('Actual backup restore committed, receipt lost');
		}
		return result;
	});
	const permission = new AbortController().signal;
	await expect(store.importFull(new File([bytes], 'actual.nexus-backup'), null, permission)).rejects.toMatchObject({
		outcome: 'unknown',
	});
	expect(store.state.status).toBe('unknown');
	expect(store.blocked).toBe(true);
	expect((await presentationApi.load()).preferences.timezone).toBe('UTC');
	await expect(
		store.importFull(new File(['x'], 'must-not-resend.nexus-backup'), null, permission),
	).rejects.toBeInstanceOf(BackupRequestFailure);
	store.reset();
	expect({ state: store.state.status, blocked: store.blocked, imports }).toEqual({
		state: 'unknown',
		blocked: true,
		imports: 1,
	});
	await app.restart();
	expect((await presentationApi.load()).preferences.timezone).toBe('UTC');
});
