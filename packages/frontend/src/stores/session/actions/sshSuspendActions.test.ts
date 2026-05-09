/**
 * SSH 挂起 Actions 单元测试
 * 测试 HTTP API 调用和 WebSocket 消息处理器
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock 依赖模块
const mockApiGet = vi.fn();
const mockApiDelete = vi.fn();
const mockApiPut = vi.fn();
const mockAddNotification = vi.fn();
const mockSendMessage = vi.fn();
const mockOnMessage = vi.fn();
const mockIsConnected = ref(true);
const mockIsSftpReady = ref(true);

vi.mock('@/utils/apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
  },
}));

vi.mock('@/utils/errorExtractor', () => ({
  extractErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../i18n', () => ({
  default: {
    global: {
      t: (key: string, params?: Record<string, unknown>) => {
        if (params) return `${key}:${JSON.stringify(params)}`;
        return key;
      },
    },
  },
}));

vi.mock('../../uiNotifications.store', () => ({
  useUiNotificationsStore: () => ({
    addNotification: mockAddNotification,
  }),
}));

vi.mock('../../connections.store', () => ({
  useConnectionsStore: () => ({
    connections: [{ id: 1, name: 'Test Server', host: '192.168.1.1', port: 22 }],
  }),
}));

vi.mock('../state', () => {
  const sessionsMap = new Map();
  const suspendedSshSessionsRef = { value: [] };
  const isLoadingRef = { value: false };
  return {
    sessions: { value: sessionsMap },
    suspendedSshSessions: suspendedSshSessionsRef,
    isLoadingSuspendedSessions: isLoadingRef,
  };
});

describe('sshSuspendActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.value = true;
  });

  describe('fetchSuspendedSshSessions', () => {
    it('应成功获取挂起会话列表', async () => {
      const mockSessions = [
        { suspendSessionId: 's1', connectionName: 'Server 1', connectionId: '1' },
      ];
      mockApiGet.mockResolvedValue({ data: mockSessions });

      const { fetchSuspendedSshSessions } = await import('./sshSuspendActions');
      const result = await fetchSuspendedSshSessions({ showLoadingIndicator: false });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(mockApiGet).toHaveBeenCalledWith('ssh-suspend/suspended-sessions');
    });

    it('获取失败时应返回错误状态', async () => {
      const error = new Error('Network error');
      mockApiGet.mockRejectedValue(error);

      const { fetchSuspendedSshSessions } = await import('./sshSuspendActions');
      const result = await fetchSuspendedSshSessions({
        showLoadingIndicator: false,
        notifyOnError: false,
      });

      expect(result.ok).toBe(false);
    });

    it('应支持显示加载指示器', async () => {
      mockApiGet.mockResolvedValue({ data: [] });

      const { fetchSuspendedSshSessions } = await import('./sshSuspendActions');
      await fetchSuspendedSshSessions({ showLoadingIndicator: true });

      expect(mockApiGet).toHaveBeenCalled();
    });

    it('应支持禁用错误通知', async () => {
      mockApiGet.mockRejectedValue(new Error('fail'));

      const { fetchSuspendedSshSessions } = await import('./sshSuspendActions');
      await fetchSuspendedSshSessions({ notifyOnError: false, showLoadingIndicator: false });

      expect(mockAddNotification).not.toHaveBeenCalled();
    });
  });

  describe('terminateAndRemoveSshSession', () => {
    it('应成功终止并移除会话', async () => {
      mockApiDelete.mockResolvedValue({});

      const { terminateAndRemoveSshSession } = await import('./sshSuspendActions');
      await terminateAndRemoveSshSession('session-123');

      expect(mockApiDelete).toHaveBeenCalledWith('ssh-suspend/terminate/session-123');
    });

    it('终止失败时应显示错误通知', async () => {
      mockApiDelete.mockRejectedValue(new Error('Delete failed'));

      const { terminateAndRemoveSshSession } = await import('./sshSuspendActions');
      await terminateAndRemoveSshSession('session-123');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  describe('removeSshSessionEntry', () => {
    it('应成功移除已断开的条目', async () => {
      mockApiDelete.mockResolvedValue({});

      const { removeSshSessionEntry } = await import('./sshSuspendActions');
      await removeSshSessionEntry('session-456');

      expect(mockApiDelete).toHaveBeenCalledWith('ssh-suspend/entry/session-456');
    });

    it('移除失败时应显示错误通知', async () => {
      mockApiDelete.mockRejectedValue(new Error('Remove failed'));

      const { removeSshSessionEntry } = await import('./sshSuspendActions');
      await removeSshSessionEntry('session-456');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  describe('editSshSessionName', () => {
    it('应成功编辑会话名称', async () => {
      mockApiPut.mockResolvedValue({ data: { customName: 'New Name' } });

      const { editSshSessionName } = await import('./sshSuspendActions');
      await editSshSessionName('session-789', 'New Name');

      expect(mockApiPut).toHaveBeenCalledWith('ssh-suspend/name/session-789', {
        customName: 'New Name',
      });
    });

    it('编辑失败时应显示错误通知', async () => {
      mockApiPut.mockRejectedValue(new Error('Edit failed'));

      const { editSshSessionName } = await import('./sshSuspendActions');
      await editSshSessionName('session-789', 'Bad Name');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  describe('exportSshSessionLog', () => {
    it('应成功导出日志', async () => {
      const mockBlob = new Blob(['log data']);
      mockApiGet.mockResolvedValue({
        data: mockBlob,
        headers: { 'content-disposition': 'filename="test.log"' },
      });

      // Mock DOM APIs
      const mockClick = vi.fn();
      const mockLink = {
        href: '',
        setAttribute: vi.fn(),
        click: mockClick,
        parentNode: { removeChild: vi.fn() },
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockLink as unknown as HTMLElement);
      vi.spyOn(document.body, 'appendChild').mockImplementation(
        () => mockLink as unknown as HTMLElement
      );

      const { exportSshSessionLog } = await import('./sshSuspendActions');
      await exportSshSessionLog('session-export');

      expect(mockApiGet).toHaveBeenCalledWith('ssh-suspend/log/session-export', {
        responseType: 'blob',
      });
      expect(mockClick).toHaveBeenCalled();
    });

    it('导出失败时应显示错误通知', async () => {
      mockApiGet.mockRejectedValue(new Error('Export failed'));

      const { exportSshSessionLog } = await import('./sshSuspendActions');
      await exportSshSessionLog('session-export');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  describe('registerSshSuspendHandlers', () => {
    it('应注册所有 SSH 挂起消息处理器', async () => {
      const mockWsManager = {
        onMessage: mockOnMessage,
        isConnected: mockIsConnected,
        isSftpReady: mockIsSftpReady,
        sendMessage: mockSendMessage,
      };

      const { registerSshSuspendHandlers } = await import('./sshSuspendActions');
      registerSshSuspendHandlers(mockWsManager as any);

      expect(mockOnMessage).toHaveBeenCalledWith(
        'SSH_MARKED_FOR_SUSPEND_ACK',
        expect.any(Function)
      );
      expect(mockOnMessage).toHaveBeenCalledWith(
        'SSH_UNMARKED_FOR_SUSPEND_ACK',
        expect.any(Function)
      );
      expect(mockOnMessage).toHaveBeenCalledWith('SSH_SUSPEND_LIST_RESPONSE', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('SSH_SUSPEND_RESUMED', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('SSH_OUTPUT_CACHED_CHUNK', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('SSH_SUSPEND_TERMINATED', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('SSH_SUSPEND_ENTRY_REMOVED', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith(
        'SSH_SUSPEND_AUTO_TERMINATED',
        expect.any(Function)
      );
    });

    it('wsManager 为 undefined 时不应崩溃', async () => {
      const { registerSshSuspendHandlers } = await import('./sshSuspendActions');

      expect(() => registerSshSuspendHandlers(undefined as any)).not.toThrow();
    });
  });

  describe('requestStartSshSuspend', () => {
    it('会话不存在时应显示错误通知', async () => {
      const { requestStartSshSuspend } = await import('./sshSuspendActions');
      requestStartSshSuspend('non-existent-session');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  describe('requestUnmarkSshSuspend', () => {
    it('会话不存在时应显示错误通知', async () => {
      const { requestUnmarkSshSuspend } = await import('./sshSuspendActions');
      requestUnmarkSshSuspend('non-existent-session');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });
});
