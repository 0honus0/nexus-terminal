import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import { sessions } from '../state';
import { reloadTabInSession } from './editorActions';

describe('editorActions.reloadTabInSession', () => {
  const sessionId = 'session-1';
  const tabId = 'session-1:/tmp/demo.txt';

  beforeEach(() => {
    sessions.value = new Map();
  });

  afterEach(() => {
    sessions.value = new Map();
  });

  it('读取失败时应保留旧内容，仅更新错误状态', async () => {
    const originalContent = 'const before = true;';
    const tab = {
      id: tabId,
      sessionId,
      filePath: '/tmp/demo.txt',
      filename: 'demo.txt',
      content: originalContent,
      originalContent,
      rawContentBase64: null,
      language: 'javascript',
      selectedEncoding: 'utf-8',
      isLoading: false,
      loadingError: null as string | null,
      isSaving: false,
      saveStatus: 'idle' as const,
      saveError: null as string | null,
      isModified: true,
      scrollTop: 0,
      scrollLeft: 0,
    };

    sessions.value = new Map([
      [
        sessionId,
        {
          editorTabs: ref([tab]),
          activeEditorTabId: ref(tabId),
        } as any,
      ],
    ]);

    const readFile = vi.fn().mockRejectedValue(new Error('network failed'));
    const getOrCreateSftpManager = vi.fn().mockReturnValue({
      readFile,
    });

    await reloadTabInSession(sessionId, tabId, {
      getOrCreateSftpManager,
      t: (key: string) => key,
    });

    expect(tab.content).toBe(originalContent);
    expect(tab.originalContent).toBe(originalContent);
    expect(tab.isLoading).toBe(false);
    expect(tab.loadingError).toContain('fileManager.errors.readFileFailed');
  });
});
