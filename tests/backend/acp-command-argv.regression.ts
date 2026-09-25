import assert from 'node:assert/strict';
import { parseAcpCommandToArgv } from '../../packages/frontend/src/features/agent/settings/acp-command-argv';

assert.deepEqual(parseAcpCommandToArgv(String.raw`acp-agent --name foo\ bar`), ['acp-agent', '--name', 'foo bar']);

assert.deepEqual(parseAcpCommandToArgv('acp-agent --name foo" bar"baz'), ['acp-agent', '--name', 'foo barbaz']);

assert.deepEqual(parseAcpCommandToArgv(String.raw`acp-agent "a\"b"`), ['acp-agent', 'a"b']);
assert.deepEqual(parseAcpCommandToArgv("acp-agent 'a b'"), ['acp-agent', 'a b']);
assert.deepEqual(parseAcpCommandToArgv('acp-agent "" tail'), ['acp-agent', '', 'tail']);
assert.deepEqual(parseAcpCommandToArgv('["acp-agent", "", "foo bar"]'), ['acp-agent', '', 'foo bar']);
assert.equal(parseAcpCommandToArgv('["acp-agent"'), null);
assert.equal(parseAcpCommandToArgv('acp-agent "unterminated'), null);
assert.equal(parseAcpCommandToArgv('acp-agent trailing\\'), null);
assert.equal(parseAcpCommandToArgv('["acp-agent", 1]'), null);
assert.deepEqual(parseAcpCommandToArgv(''), []);

process.stdout.write('ACP command argv regression: PASS\n');
