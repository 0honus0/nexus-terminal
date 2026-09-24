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

const invalidation = slice('const invalidateThreadPagination =', 'const refreshThreadListFromHost =');
assert(
  invalidation.includes('threadListLoadingMore.value = false;'),
  'authoritative thread-list changes must release an invalidated pagination spinner',
);
assert(
  invalidation.includes('return ++threadListRefreshGeneration;'),
  'thread pagination invalidation must advance the shared list generation',
);

const refresh = slice('const refreshThreadListFromHost = async', 'const onThreadChanged =');
assert(
  refresh.includes('const requestGeneration = invalidateThreadPagination();'),
  'authoritative first-page refresh must invalidate in-flight pagination',
);
assert(
  refresh.includes('if (requestGeneration !== threadListRefreshGeneration) return;'),
  'older first-page refreshes must remain generation guarded',
);

const loadMore = slice('const loadMoreThreads = async', 'const loadRunConfiguration = async');
assert(
  loadMore.includes('const requestGeneration = threadListRefreshGeneration;'),
  'pagination must capture the current thread-list generation',
);
const commitGuard =
  'if (requestGeneration !== threadListRefreshGeneration || threadNextCursor.value !== cursor) return;';
assert(
  loadMore.split(commitGuard).length - 1 >= 2,
  'pagination success and failure paths must both reject stale generation/cursor pairs',
);
assert(
  loadMore.indexOf(commitGuard) < loadMore.indexOf('threads.value = [...threads.value'),
  'stale pagination must be rejected before appending items',
);
assert(
  loadMore.indexOf(commitGuard) < loadMore.indexOf('threadNextCursor.value = page.nextCursor;'),
  'stale pagination must be rejected before replacing the cursor',
);
assert(
  loadMore.includes(
    'if (requestGeneration === threadListRefreshGeneration) threadListLoadingMore.value = false;',
  ),
  'an invalidated request must not clear a newer pagination loading state',
);

const createThread = slice('const createThread = async', 'const beginThreadCreation = async');
assert(
  createThread.indexOf('invalidateThreadPagination();') >
    createThread.indexOf('await facade.createThread'),
  'successful thread creation must invalidate older pagination before mutating the local list',
);
assert(
  createThread.indexOf('invalidateThreadPagination();') <
    createThread.indexOf('threads.value = [thread'),
  'creation invalidation must happen before local list commit',
);

const initialLoad = slice('const load = async', 'const beginRuntimeMutation =');
assert(
  initialLoad.includes('invalidateThreadPagination();'),
  'full surface thread-list reload must invalidate in-flight pagination',
);

const selectFirst = slice('const selectFirstOrCreateThread = async', 'const deleteThreadConversation = async');
assert(
  selectFirst.indexOf('invalidateThreadPagination();') <
    selectFirst.indexOf('facade.listThreads(undefined'),
  'replacement first-page load after deletion must invalidate older pagination before reading',
);

const deleteThread = slice('const deleteThreadConversation = async', 'const requestDeleteThread =');
assert(
  deleteThread.indexOf('invalidateThreadPagination();') >
    deleteThread.indexOf('await facade.deleteThread(thread);'),
  'failed deletes must not invalidate pagination, but successful deletes must',
);
assert(
  deleteThread.indexOf('invalidateThreadPagination();') <
    deleteThread.indexOf('threads.value = threads.value.filter'),
  'delete invalidation must happen before local list commit',
);

const deleteAll = slice('const deleteAllConversations = async', 'const requestDeleteAllConversations =');
assert(
  deleteAll.indexOf('invalidateThreadPagination();') >
    deleteAll.indexOf('await facade.deleteAllThreads();'),
  'successful delete-all must invalidate older pagination',
);

process.stdout.write('agent thread pagination generation regression: PASS\n');
