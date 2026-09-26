import { describe, expect, it, vi } from 'vitest';
import { createFilePreviewSession } from '@/features/file-preview/composables/useFilePreviewTabs';
import type { FilePreviewReadResult, FilePreviewSource } from '@/features/file-preview/ports/file-preview-source';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('createFilePreviewSession', () => {
  it('aborts a superseded open and ignores its late response', async () => {
    const first = deferred<FilePreviewReadResult>();
    const second = deferred<FilePreviewReadResult>();
    const read = vi
      .fn<FilePreviewSource['read']>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const session = createFilePreviewSession({ read });

    const firstOpen = session.open('/first.md');
    const firstSignal = read.mock.calls[0]?.[1]?.signal;
    expect(firstSignal?.aborted).toBe(false);
    const secondOpen = session.open('/second.md');
    expect(firstSignal?.aborted).toBe(true);
    expect(read.mock.calls[0]?.[1]?.maxBytes).toBe(2 * 1024 * 1024);

    const secondBytes = new Uint8Array([2]).buffer;
    second.resolve({ bytes: secondBytes });
    await secondOpen;
    first.resolve({ bytes: new Uint8Array([1]).buffer });
    await firstOpen;

    expect(session.tabs.value.map((tab) => tab.path)).toEqual(['/second.md']);
    expect(session.active.value?.file?.bytes).toBe(secondBytes);
    expect(session.active.value?.loading).toBe(false);
  });
});
