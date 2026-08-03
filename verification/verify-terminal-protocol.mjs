import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = await readFile(path.join(root, 'packages/backend/src/websocket/terminal-binary-protocol.ts'), 'utf8');
const frontend = await readFile(path.join(root, 'packages/frontend/src/utils/terminalBinaryProtocol.ts'), 'utf8');

const numericConstant = (source, name) => {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  assert.ok(match, `Missing protocol constant ${name}`);
  const expression = match[1].trim();
  assert.match(expression, /^[\d\s*+()-]+$/, `Unsafe numeric expression for ${name}`);
  return Function(`"use strict"; return (${expression});`)();
};

assert.match(backend, /Buffer\.from\('NXTM',\s*'ascii'\)/, 'Backend terminal magic must be NXTM');
assert.match(frontend, /0x4e,\s*0x58,\s*0x54,\s*0x4d/, 'Frontend terminal magic must be NXTM');
assert.equal(numericConstant(backend, 'TERMINAL_FRAME_VERSION'), numericConstant(frontend, 'TERMINAL_FRAME_VERSION'));
assert.equal(numericConstant(backend, 'TERMINAL_FRAME_HEADER_SIZE'), numericConstant(frontend, 'TERMINAL_FRAME_MIN_HEADER_SIZE'));
assert.equal(numericConstant(backend, 'MAX_TERMINAL_FRAME_PAYLOAD_BYTES'), numericConstant(frontend, 'MAX_TERMINAL_FRAME_PAYLOAD_BYTES'));

for (const declaration of ['Output = 1', 'CachedOutput = 2', 'Final = 1 << 0']) {
  assert.ok(backend.includes(declaration), `Backend protocol is missing ${declaration}`);
  assert.ok(frontend.includes(declaration), `Frontend protocol is missing ${declaration}`);
}

console.log('Terminal binary protocol v1 consistency check passed.');
