import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../packages/frontend/src/features/agent/host/AgentLauncher.vue', import.meta.url),
  'utf8',
);

assert(source.includes('const HOLD_MS = 320;'));
assert(source.includes('const MOVE_CANCEL_PX = 10;'));
assert(source.includes('const RESET_VISIBLE_MS = 7000;'));
assert(source.includes('if (Math.hypot(dx, dy) > MOVE_CANCEL_PX)'));
assert(source.includes('if (pointerId === event.pointerId && !hasMoved) dragging.value = true;'));
assert(source.includes('data-agent-launcher-reset'));
assert(source.includes('agentWindowManager.setLauncherPosition(clamp(startRight, startBottom))'));
assert(source.includes('agentWindowManager.openHub({ restoreRecent: true });'));
assert(!source.includes('DRAG_THRESHOLD_PX = 4'));
assert(!source.includes('@click="handleClick"'));

process.stdout.write('Agent launcher long-press regression: PASS\n');
