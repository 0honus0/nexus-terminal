import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  useFileEditorStore,
  getLanguageFromFilename,
  getFilenameFromPath,
} from './fileEditor.store';

// Mock 依赖
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@vscode/iconv-lite-umd', () => ({
  encodingExists: vi.fn().mockReturnValue(true),
  decode: vi.fn().mockReturnValue('decoded content'),
}));

vi.mock('buffer/', () => ({
  Buffer: {
    from: vi.fn().mockReturnValue({
      toString: vi.fn().mockReturnValue('mock base64'),
    }),
  },
}));

const mockGetOrCreateSftpManager = vi.fn();
const mockSessions = new Map();

vi.mock('./session.store', () => ({
  useSessionStore: () => ({
    sessions: mockSessions,
    getOrCreateSftpManager: mockGetOrCreateSftpManager,
  }),
}));

/**
 * 通过 openFile action 创建标签页（SFTP 管理器为空时会创建带错误状态的标签页）
 * 因为 store 暴露的 tabs 是 readonly(tabs)，外部无法直接调用 Map.set()
 */
async function createTab(
  store: ReturnType<typeof useFileEditorStore>,
  filePath: string,
  sessionId: string = 's1'
) {
  mockGetOrCreateSftpManager.mockReturnValue(null);
  await store.openFile(filePath, sessionId, 'primary');
  return `${sessionId}:${filePath}`;
}

describe('fileEditor.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockSessions.clear();
  });

  describe('辅助函数', () => {
    describe('getLanguageFromFilename', () => {
      it('应该正确识别 JavaScript 文件', () => {
        expect(getLanguageFromFilename('app.js')).toBe('javascript');
      });

      it('应该正确识别 TypeScript 文件', () => {
        expect(getLanguageFromFilename('index.ts')).toBe('typescript');
      });

      it('应该正确识别 JSON 文件', () => {
        expect(getLanguageFromFilename('package.json')).toBe('json');
      });

      it('应该正确识别 HTML 文件', () => {
        expect(getLanguageFromFilename('index.html')).toBe('html');
      });

      it('应该正确识别 CSS 文件', () => {
        expect(getLanguageFromFilename('style.css')).toBe('css');
      });

      it('应该正确识别 Python 文件', () => {
        expect(getLanguageFromFilename('main.py')).toBe('python');
      });

      it('应该正确识别 Shell 脚本', () => {
        expect(getLanguageFromFilename('deploy.sh')).toBe('shell');
      });

      it('应该正确识别 YAML 文件', () => {
        expect(getLanguageFromFilename('config.yaml')).toBe('yaml');
        expect(getLanguageFromFilename('config.yml')).toBe('yaml');
      });

      it('应该正确识别 Markdown 文件', () => {
        expect(getLanguageFromFilename('README.md')).toBe('markdown');
      });

      it('未知扩展名应返回 plaintext', () => {
        expect(getLanguageFromFilename('data.xyz')).toBe('plaintext');
      });

      it('无扩展名应返回 plaintext', () => {
        expect(getLanguageFromFilename('Makefile')).toBe('plaintext');
      });

      it('应该正确识别 Rust 文件', () => {
        expect(getLanguageFromFilename('main.rs')).toBe('rust');
      });

      it('应该正确识别 Go 文件', () => {
        expect(getLanguageFromFilename('main.go')).toBe('go');
      });

      it('应该正确识别 SQL 文件', () => {
        expect(getLanguageFromFilename('query.sql')).toBe('sql');
      });
    });

    describe('getFilenameFromPath', () => {
      it('应该从完整路径中提取文件名', () => {
        expect(getFilenameFromPath('/home/user/file.txt')).toBe('file.txt');
      });

      it('应该处理只有文件名的路径', () => {
        expect(getFilenameFromPath('file.txt')).toBe('file.txt');
      });

      it('应该处理多级目录路径', () => {
        expect(getFilenameFromPath('/a/b/c/d/file.txt')).toBe('file.txt');
      });

      it('应该处理以斜杠结尾的路径', () => {
        expect(getFilenameFromPath('/home/user/')).toBe('/home/user/');
      });
    });
  });

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useFileEditorStore();
      expect(store.tabs.size).toBe(0);
      expect(store.activeTabId).toBeNull();
      expect(store.activeTab).toBeNull();
      expect(store.orderedTabs).toEqual([]);
      expect(store.popupTrigger).toBe(0);
      expect(store.popupFileInfo).toBeNull();
    });
  });

  describe('setActiveTab', () => {
    it('应该激活存在的标签页', async () => {
      const store = useFileEditorStore();
      const tabId = await createTab(store, '/file.txt');

      expect(store.activeTabId).toBe(tabId);
      expect(store.activeTab).toBeTruthy();
      expect(store.activeTab?.filePath).toBe('/file.txt');
    });

    it('激活不存在的标签页不应改变状态', () => {
      const store = useFileEditorStore();

      store.setActiveTab('nonexistent');

      expect(store.activeTabId).toBeNull();
    });
  });

  describe('closeTab', () => {
    it('应该关闭指定的标签页', async () => {
      const store = useFileEditorStore();
      const tabId = await createTab(store, '/file.txt');

      store.closeTab(tabId);

      expect(store.tabs.size).toBe(0);
      expect(store.activeTabId).toBeNull();
    });

    it('关闭当前激活标签页后应切换到其他标签页', async () => {
      const store = useFileEditorStore();
      await createTab(store, '/file1.txt');
      const tabId2 = await createTab(store, '/file2.txt');

      // 当前激活的是最后打开的标签页
      expect(store.activeTabId).toBe(tabId2);

      store.closeTab(tabId2);

      expect(store.tabs.size).toBe(1);
      expect(store.activeTabId).toBe('s1:/file1.txt');
    });

    it('关闭不存在的标签页不应报错', () => {
      const store = useFileEditorStore();
      store.closeTab('nonexistent');
      expect(store.tabs.size).toBe(0);
    });
  });

  describe('closeAllTabs', () => {
    it('应该关闭所有标签页', async () => {
      const store = useFileEditorStore();
      await createTab(store, '/a');
      await createTab(store, '/b');

      store.closeAllTabs();

      expect(store.tabs.size).toBe(0);
      expect(store.activeTabId).toBeNull();
    });
  });

  describe('closeOtherTabs', () => {
    it('应该关闭除目标标签页外的所有标签页', async () => {
      const store = useFileEditorStore();
      await createTab(store, '/file1.txt');
      const tabId2 = await createTab(store, '/file2.txt');
      await createTab(store, '/file3.txt');

      store.closeOtherTabs(tabId2);

      expect(store.tabs.size).toBe(1);
      expect(store.tabs.has(tabId2)).toBe(true);
    });

    it('目标标签页不存在时不应关闭任何标签页', async () => {
      const store = useFileEditorStore();
      await createTab(store, '/file1.txt');

      store.closeOtherTabs('nonexistent');

      expect(store.tabs.size).toBe(1);
    });
  });

  describe('closeTabsToTheRight', () => {
    it('应该关闭目标右侧的所有标签页', async () => {
      const store = useFileEditorStore();
      const tabId1 = await createTab(store, '/file1.txt');
      const tabId2 = await createTab(store, '/file2.txt');
      const tabId3 = await createTab(store, '/file3.txt');
      const tabId4 = await createTab(store, '/file4.txt');

      store.closeTabsToTheRight(tabId2);

      expect(store.tabs.size).toBe(2);
      expect(store.tabs.has(tabId1)).toBe(true);
      expect(store.tabs.has(tabId2)).toBe(true);
      expect(store.tabs.has(tabId3)).toBe(false);
      expect(store.tabs.has(tabId4)).toBe(false);
    });

    it('目标标签页不存在时不应关闭任何标签页', async () => {
      const store = useFileEditorStore();
      await createTab(store, '/file1.txt');

      store.closeTabsToTheRight('nonexistent');

      expect(store.tabs.size).toBe(1);
    });
  });

  describe('closeTabsToTheLeft', () => {
    it('应该关闭目标左侧的所有标签页', async () => {
      const store = useFileEditorStore();
      const tabId1 = await createTab(store, '/file1.txt');
      const tabId2 = await createTab(store, '/file2.txt');
      const tabId3 = await createTab(store, '/file3.txt');
      const tabId4 = await createTab(store, '/file4.txt');

      store.closeTabsToTheLeft(tabId3);

      expect(store.tabs.size).toBe(2);
      expect(store.tabs.has(tabId1)).toBe(false);
      expect(store.tabs.has(tabId2)).toBe(false);
      expect(store.tabs.has(tabId3)).toBe(true);
      expect(store.tabs.has(tabId4)).toBe(true);
    });

    it('目标标签页不存在时不应关闭任何标签页', async () => {
      const store = useFileEditorStore();
      await createTab(store, '/file1.txt');

      store.closeTabsToTheLeft('nonexistent');

      expect(store.tabs.size).toBe(1);
    });
  });

  describe('updateFileContent', () => {
    it('应该更新标签页内容并标记为已修改', async () => {
      const store = useFileEditorStore();
      const tabId = await createTab(store, '/file.txt');
      // openFile 创建的标签页 content 为 ''，originalContent 为 ''

      store.updateFileContent(tabId, 'new content');

      expect(store.tabs.get(tabId)?.content).toBe('new content');
      expect(store.tabs.get(tabId)?.isModified).toBe(true);
    });

    it('内容与原始内容相同时应标记为未修改', async () => {
      const store = useFileEditorStore();
      const tabId = await createTab(store, '/file.txt');
      // openFile 创建的标签页 content 为 ''，originalContent 为 ''

      store.updateFileContent(tabId, '');

      expect(store.tabs.get(tabId)?.isModified).toBe(false);
    });

    it('加载完成的标签页应可以更新内容', async () => {
      const store = useFileEditorStore();
      const tabId = await createTab(store, '/file.txt');
      // openFile 创建的标签页 isLoading 为 false

      store.updateFileContent(tabId, 'new content');

      expect(store.tabs.get(tabId)?.content).toBe('new content');
    });

    it('不存在的标签页不应报错', () => {
      const store = useFileEditorStore();
      store.updateFileContent('nonexistent', 'content');
    });
  });

  describe('changeEncoding', () => {
    it('不存在的标签页不应操作', () => {
      const store = useFileEditorStore();
      store.changeEncoding('nonexistent', 'utf-8');
      // 不应抛出错误
    });

    it('编码相同时不应操作', async () => {
      const store = useFileEditorStore();
      const tabId = await createTab(store, '/file.txt');
      // openFile 创建的标签页 selectedEncoding 为 'utf-8'

      store.changeEncoding(tabId, 'utf-8');

      expect(store.tabs.get(tabId)?.selectedEncoding).toBe('utf-8');
    });

    it('没有原始数据时应设置错误', async () => {
      const store = useFileEditorStore();
      const tabId = await createTab(store, '/file.txt');
      // openFile 创建的标签页 rawContentBase64 为 null

      store.changeEncoding(tabId, 'gbk');

      expect(store.tabs.get(tabId)?.loadingError).toBeTruthy();
    });
  });

  describe('triggerPopup', () => {
    it('应该更新弹窗信息并增加触发器值', () => {
      const store = useFileEditorStore();

      store.triggerPopup('/file.txt', 'session1');

      expect(store.popupFileInfo).toEqual({
        filePath: '/file.txt',
        sessionId: 'session1',
      });
      expect(store.popupTrigger).toBe(1);
    });

    it('多次调用应递增触发器值', () => {
      const store = useFileEditorStore();

      store.triggerPopup('/file1.txt', 'session1');
      store.triggerPopup('/file2.txt', 'session1');

      expect(store.popupTrigger).toBe(2);
    });
  });

  describe('updateTabScrollPosition', () => {
    it('应该更新标签页的滚动位置', async () => {
      const store = useFileEditorStore();
      const tabId = await createTab(store, '/file.txt');

      store.updateTabScrollPosition(tabId, 100, 50);

      expect(store.tabs.get(tabId)?.scrollTop).toBe(100);
      expect(store.tabs.get(tabId)?.scrollLeft).toBe(50);
    });

    it('不存在的标签页不应报错', () => {
      const store = useFileEditorStore();
      store.updateTabScrollPosition('nonexistent', 100, 50);
    });
  });

  describe('openFile', () => {
    it('SFTP 管理器不存在时应设置错误', async () => {
      const store = useFileEditorStore();
      mockGetOrCreateSftpManager.mockReturnValue(null);

      await store.openFile('/file.txt', 'session1', 'primary');

      expect(store.tabs.size).toBe(1);
      const tab = Array.from(store.tabs.values())[0];
      expect(tab.loadingError).toBeTruthy();
      expect(tab.isLoading).toBe(false);
    });

    it('已存在的标签页应直接激活', async () => {
      const store = useFileEditorStore();
      const tabId = await createTab(store, '/file.txt');

      // 再打开一个不同的文件，改变激活标签
      const tabId2 = await createTab(store, '/file2.txt');
      expect(store.activeTabId).toBe(tabId2);

      // 重新打开第一个文件 → 应该激活已有标签页
      await store.openFile('/file.txt', 's1', 'primary');

      expect(store.tabs.size).toBe(2);
      expect(store.activeTabId).toBe(tabId);
    });
  });

  describe('orderedTabs', () => {
    it('应该返回所有标签页的数组', async () => {
      const store = useFileEditorStore();
      await createTab(store, '/a');
      await createTab(store, '/b');

      expect(store.orderedTabs).toHaveLength(2);
    });
  });
});
