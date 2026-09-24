import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROJECT_INSTRUCTION_LIMITS,
  resolveProjectInstructions,
} from '../../packages/agent-runner/src/controller/project-instructions';
import { decodeProjectInstructionProjection } from '../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http-protocol';

const main = (): void => {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instruction-omissions-'));
  try {
    fs.mkdirSync(path.join(workRoot, '.git'));
    fs.writeFileSync(path.join(workRoot, 'AGENTS.md'), 'root\n');

    const segments: string[] = [];
    for (let index = 0; index < 64; index += 1) {
      segments.push(`level-${index}`);
      const directory = path.join(workRoot, ...segments);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'AGENTS.md'), `instruction-${index}\n`);
    }

    const target = `/workspace/work/${segments.join('/')}`;
    const projection = resolveProjectInstructions(workRoot, [target]);

    assert.equal(PROJECT_INSTRUCTION_LIMITS.maxInstructionFiles, 16);
    assert.equal(PROJECT_INSTRUCTION_LIMITS.maxOmissionDetails, 32);
    assert.equal(projection.instructions.length, 16);
    assert.equal(
      projection.omitted.length,
      32,
      'producer omission evidence must stay within the wire decoder contract',
    );
    assert(projection.omitted.every((item) => item.reason === 'too_many_files'));

    const decoded = decodeProjectInstructionProjection(projection);
    assert.equal(decoded.instructions.length, 16);
    assert.equal(decoded.omitted.length, 32);
    assert.equal(decoded.targetDirectories[0], target);

    process.stdout.write('Project instruction omission contract regression: PASS\n');
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
};

main();
