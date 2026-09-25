import assert from 'node:assert/strict';
import {
  normalizeAbsoluteRemotePath,
  remoteFileResourceKey,
} from '../../packages/backend/src/platform/filesystem/remote-path';

const literalBackslash = '/{{.Destination}}\\n{{end}}"';
assert.equal(
  normalizeAbsoluteRemotePath(literalBackslash),
  literalBackslash,
  'POSIX remote paths must preserve literal backslashes in filenames',
);

const actualNewline = '/line\nbreak\'"$;[]{}.txt';
assert.equal(
  normalizeAbsoluteRemotePath(actualNewline),
  actualNewline,
  'POSIX remote paths must preserve quotes, shell metacharacters, and line breaks',
);

assert.equal(normalizeAbsoluteRemotePath('/folder/../name\\segment'), '/name\\segment');
const leaseKey = remoteFileResourceKey('connection:42', actualNewline);
assert.match(leaseKey, /^connection:42:file:sha256:[a-f0-9]{64}$/);
assert.ok(!/[\r\n\0]/.test(leaseKey));
assert.equal(leaseKey, remoteFileResourceKey('connection:42', actualNewline));
assert.notEqual(leaseKey, remoteFileResourceKey('connection:42', literalBackslash));

assert.throws(() => normalizeAbsoluteRemotePath('/bad\0name'), /null byte/);
assert.throws(() => normalizeAbsoluteRemotePath('relative\\name'), /must be absolute/);

process.stdout.write('remote POSIX path compatibility regression: PASS\n');
