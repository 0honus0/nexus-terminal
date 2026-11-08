import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	REMOTE_FILE_MAX_WRITE_REQUEST_BYTES,
	REMOTE_FILE_MAX_TEXT_BYTES,
} from '../../../../packages/shared/src/remote/files/values.ts';
import {
	InvalidRemoteFilePayload,
	readRemoteFileWriteTextRequest,
} from '../../../../packages/shared/src/remote/files/http-codec.ts';

test('file write codec accounts for UTF-8, escaped JSON and Unicode at its complete text budget', () => {
	const chineseCount = Math.floor(REMOTE_FILE_MAX_TEXT_BYTES / 3);
	const suffixBytes = REMOTE_FILE_MAX_TEXT_BYTES - chineseCount * 3;
	const exact = '中'.repeat(chineseCount) + 'a'.repeat(suffixBytes);
	assert.equal(Buffer.byteLength(exact, 'utf8'), REMOTE_FILE_MAX_TEXT_BYTES);
	assert.equal(
		readRemoteFileWriteTextRequest({ path: '/容量.txt', text: exact, expectedSha256: null }).text.length,
		exact.length,
	);
	assert.throws(
		() => readRemoteFileWriteTextRequest({ path: '/容量.txt', text: exact + '中', expectedSha256: null }),
		InvalidRemoteFilePayload,
	);
	const escaped = '\\'.repeat(REMOTE_FILE_MAX_TEXT_BYTES);
	const escapedRequest = { path: '/escaped.txt', text: escaped, expectedSha256: null };
	assert.ok(Buffer.byteLength(JSON.stringify(escapedRequest), 'utf8') <= REMOTE_FILE_MAX_WRITE_REQUEST_BYTES);
	assert.equal(readRemoteFileWriteTextRequest(escapedRequest).text.length, REMOTE_FILE_MAX_TEXT_BYTES);
	assert.equal(
		readRemoteFileWriteTextRequest({ path: '/emoji-😀.txt', text: 'A😀B', expectedSha256: null }).text,
		'A😀B',
	);
	assert.throws(
		() => readRemoteFileWriteTextRequest({ path: '/bad.txt', text: 'bad\u0000text', expectedSha256: null }),
		InvalidRemoteFilePayload,
	);
});
