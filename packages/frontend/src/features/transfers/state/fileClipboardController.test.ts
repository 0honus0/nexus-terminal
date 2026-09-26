import { describe, expect, it } from 'vitest';
import { createFileClipboardController } from './fileClipboardController';

describe('createFileClipboardController', () => {
  it('keeps a snapshot of the selected items and clears only the current generation', () => {
    const clipboard = createFileClipboardController();
    const items = [{ path: '/first.txt', name: 'first.txt', type: 'file' as const }];
    const first = clipboard.set('copy', 'source', items)!;
    items[0]!.name = 'changed.txt';
    expect(clipboard.value.value?.items[0]?.name).toBe('first.txt');

    const second = clipboard.set('cut', 'source', [{ path: '/second.txt', name: 'second.txt', type: 'file' }])!;
    expect(clipboard.clear(first.generation)).toBe(false);
    expect(clipboard.value.value?.generation).toBe(second.generation);
    expect(clipboard.count.value).toBe(1);
    expect(clipboard.clear(second.generation)).toBe(true);
    expect(clipboard.count.value).toBe(0);
  });

  it('drops an incomplete clipboard request', () => {
    const clipboard = createFileClipboardController();
    clipboard.set('copy', 'source', [{ path: '/file', name: 'file', type: 'file' }]);
    expect(clipboard.set('copy', '', [])).toBeNull();
    expect(clipboard.value.value).toBeNull();
  });
});
