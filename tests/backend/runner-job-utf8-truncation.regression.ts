import assert from 'node:assert/strict';
import { JobRunner } from '../../packages/agent-runner/src/worker/job-runner';

const runBytes = async (bytes: number[], maxBytes: number, split = false) => {
  const script = split
    ? `process.stdout.write(Buffer.from([${bytes[0]}])); setTimeout(() => { process.stdout.write(Buffer.from([${bytes
        .slice(1)
        .join(',')}])); }, 20)`
    : `process.stdout.write(Buffer.from([${bytes.join(',')}]))`;
  return new JobRunner().run(['-e', script], process.cwd(), maxBytes, 5_000, {
    executable: process.execPath,
    env: { ...process.env },
  });
};

const main = async (): Promise<void> => {
  const chinese = [0xe4, 0xb8, 0xad];
  const emoji = [0xf0, 0x9f, 0x98, 0x80];

  for (const maxBytes of [1, 2]) {
    const result = await runBytes(chinese, maxBytes);
    assert.equal(result.stdout, '', `budget ${maxBytes} must drop an incomplete UTF-8 code point`);
    assert.equal(result.stdout.includes('�'), false);
    assert.equal(result.truncated, true);
    assert(Buffer.byteLength(result.stdout, 'utf8') <= maxBytes);
  }

  const complete = await runBytes(chinese, 3);
  assert.equal(complete.stdout, '中');
  assert.equal(complete.truncated, false);

  const split = await runBytes(chinese, 3, true);
  assert.equal(split.stdout, '中', 'a code point split across pipe chunks must decode exactly once');
  assert.equal(split.stdout.includes('�'), false);

  for (const maxBytes of [1, 2, 3]) {
    const result = await runBytes(emoji, maxBytes);
    assert.equal(result.stdout, '');
    assert.equal(result.stdout.includes('�'), false);
    assert.equal(result.truncated, true);
    assert(Buffer.byteLength(result.stdout, 'utf8') <= maxBytes);
  }
  const emojiComplete = await runBytes(emoji, 4);
  assert.equal(emojiComplete.stdout, '😀');

  const mixed = await new JobRunner().run(
    ['-e', "process.stdout.write('中'); process.stderr.write('ab')"],
    process.cwd(),
    4,
    5_000,
    { executable: process.execPath, env: { ...process.env } },
  );
  assert(Buffer.byteLength(mixed.stdout, 'utf8') + Buffer.byteLength(mixed.stderr, 'utf8') <= 4);
  assert.equal((mixed.stdout + mixed.stderr).includes('�'), false);
  assert.equal(mixed.truncated, true);

  process.stdout.write('runner Job UTF-8 truncation regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
