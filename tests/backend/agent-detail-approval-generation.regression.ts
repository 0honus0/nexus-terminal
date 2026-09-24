import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../packages/frontend/src/features/agent/host/AgentAppSurface.vue', import.meta.url),
  'utf8',
);

const slice = (startMarker: string, endMarker: string): string => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `expected source slice ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
};

assert(
  source.includes('let detailApprovalGeneration = 0;'),
  'detail approval refreshes need their own generation',
);

const refresh = slice('const refreshDetailApprovalBatch = async', 'const refreshDetailSubagents = async');
assert(
  refresh.includes('const requestGeneration = ++detailApprovalGeneration;'),
  'each detail approval refresh must advance the generation',
);
assert(
  refresh.includes('requestGeneration !== detailApprovalGeneration'),
  'stale detail approval refreshes must not commit',
);
assert(
  refresh.includes('!detailVisible.value') && refresh.includes('detailSnapshot.value?.id !== runId'),
  'generation guard must remain paired with visible/run identity guards',
);
assert(
  refresh.indexOf('requestGeneration !== detailApprovalGeneration') <
    refresh.indexOf('detailApprovalBatch.value = next;'),
  'stale guard must run before approval state commit',
);
assert(
  refresh.indexOf('detailApprovalBatch.value = next;') <
    refresh.indexOf('detailSnapshot.value = snapshot;'),
  'approvals and snapshot must commit in the same accepted generation block',
);

const openDetail = slice('const openRunDetail = async', 'const closeRunDetail =');
assert(
  openDetail.includes('const approvalGeneration = ++detailApprovalGeneration;'),
  'opening detail must invalidate older approval refreshes',
);
assert(
  openDetail.includes(
    "if (detailApprovals.status === 'fulfilled' && approvalGeneration === detailApprovalGeneration)",
  ),
  'open-detail approvals must not overwrite a newer stream/mutation refresh',
);
assert(
  openDetail.includes('approvalGeneration === detailApprovalGeneration ? detailApprovals : null'),
  'a superseded open-detail approval failure must not surface after a newer refresh wins',
);

const closeDetail = slice('const closeRunDetail =', 'const saveCheckpoint = async');
assert(
  closeDetail.includes('detailApprovalGeneration += 1;'),
  'closing detail must invalidate in-flight approval refreshes',
);

process.stdout.write('agent detail approval generation regression: PASS\n');
