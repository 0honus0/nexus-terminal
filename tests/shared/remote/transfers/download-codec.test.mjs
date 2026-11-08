import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	readDownloadTicketResponse,
	readWorkspaceTransferHttpError,
} from '@nexus-terminal/shared/remote/transfers/http-codec';

test('download tickets reject unsafe navigation, expiry and transport envelopes', () => {
	const ticket = { url: '/api/v1/sftp/download?ticket=fixture.secret', expiresInSeconds: 300 };
	assert.deepEqual(readDownloadTicketResponse({ ...ticket, password: 'discard' }), ticket);
	let codecChecks = 1;
	for (const url of [
		'https://elsewhere.test/api/v1/sftp/download?ticket=x',
		'//elsewhere.test/x',
		'/api/v1/sftp/download?ticket=x&other=y',
		'/api/v1/sftp/download?ticket=x#fragment',
		'/api/v1/sftp/download-directory?ticket=x',
		'/api/v1/sftp/download?ticket=%0A',
	]) {
		assert.throws(() => readDownloadTicketResponse({ ...ticket, url }));
		codecChecks++;
	}
	for (const expiresInSeconds of [0, 301, '300', null]) {
		assert.throws(() => readDownloadTicketResponse({ ...ticket, expiresInSeconds }));
		codecChecks++;
	}
	assert.throws(() => readWorkspaceTransferHttpError({ message: 'raw diagnostic' }));
	assert.throws(() => readWorkspaceTransferHttpError({ message: 'not_found', code: 'not_found' }));
	codecChecks += 2;
	assert.deepEqual(readWorkspaceTransferHttpError({ code: 'invalid_body' }), { code: 'invalid_body' });
	codecChecks++;
});
