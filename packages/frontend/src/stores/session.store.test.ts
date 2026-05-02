import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';

// Mock 依赖
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('./connections.store', () => ({
  useConnectionsStore: () => ({
    connections: [
      { id: 1, name: 'Test SSH', host: '192.168.1.1', port: 22, type: 'SSH' },
      { id: 2, name: 'Test RDP', host: '192.168.1.2', port: 3389, type: 'RDP' },
      { id: 3, name: 'Test VNC', host: '192.168.1.3', port: 5900, type: 'VNC' },
    ],
  }),
}));

// Mock session state
const mockSessions = new Map();
const mockActiveSessionId = ref<string | null>(null);
const mockIsRdpModalOpen = ref(false);
const mockRdpConnectionInfo = ref(null);
const mockIsVncModalOpen = ref(false);
const mockVncConnectionInfo = ref(null);
const mockSuspendedSshSessions = ref([]);
const mockIsLoadingSuspendedSessions = ref(false);

vi.mock('./session/state', () => ({
  sessions: mockSessions,
  activeSessionId: mockActiveSessionId,
  isRdpModalOpen: mockIsRdpModalOpen,
  rdpConnectionInfo: mockRdpConnectionInfo,
  isVncModalOpen: mockIsVncModalOpen,
  vncConnectionInfo: mockVncConnectionInfo,
  suspendedSshSessions: mockSuspendedSshSessions,
  isLoadingSuspendedSessions: mockIsLoadingSuspendedSessions,
}));

const mockSessionTabs = ref([]);
const mockSessionTabsWithStatus = ref([]);
const mockActiveSession = ref(null);

vi.mock('./session/getters', () => ({
  sessionTabs: mockSessionTabs,
  sessionTabsWithStatus: mockSessionTabsWithStatus,
  activeSession: mockActiveSession,
}));

vi.mock('./session/actions/sessionActions', () => ({
  openNewSession: vi.fn(),
  activateSession: vi.fn(),
  closeSession: vi.fn(),
  handleConnectRequest: vi.fn(),
  handleOpenNewSession: vi.fn(),
  cleanupAllSessions: vi.fn(),
}));

vi.mock('./session/actions/editorActions', () => ({
  openFileInSession: vi.fn(),
  closeEditorTabInSession: vi.fn(),
  setActiveEditorTabInSession: vi.fn(),
  updateFileContentInSession: vi.fn(),
  saveFileInSession: vi.fn(),
  reloadTabInSession: vi.fn(),
  changeEncodingInSession: vi.fn(),
  closeOtherTabsInSession: vi.fn(),
  closeTabsToTheRightInSession: vi.fn(),
  closeTabsToTheLeftInSession: vi.fn(),
  updateTabScrollPositionInSession: vi.fn(),
}));

vi.mock('./session/actions/sftpManagerActions', () => ({
  getOrCreateSftpManager: vi.fn(),
  removeSftpManager: vi.fn(),
}));

vi.mock('./session/actions/modalActions', () => ({
  openRdpModal: vi.fn(),
  closeRdpModal: vi.fn(),
  openVncModal: vi.fn(),
  closeVncModal: vi.fn(),
}));

vi.mock('./session/actions/commandInputActions', () => ({
  updateSessionCommandInput: vi.fn(),
}));

vi.mock('./session/actions/sshSuspendActions', () => ({
  requestStartSshSuspend: vi.fn(),
  requestUnmarkSshSuspend: vi.fn(),
  fetchSuspendedSshSessions: vi.fn(),
  resumeSshSession: vi.fn(),
  terminateAndRemoveSshSession: vi.fn(),
  removeSshSessionEntry: vi.fn(),
  editSshSessionName: vi.fn(),
  exportSshSessionLog: vi.fn(),
  registerSshSuspendHandlers: vi.fn(),
}));

describe('session.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockSessions.clear();
    mockActiveSessionId.value = null;
    mockIsRdpModalOpen.value = false;
    mockRdpConnectionInfo.value = null;
    mockIsVncModalOpen.value = false;
    mockVncConnectionInfo.value = null;
    mockSuspendedSshSessions.value = [];
    mockIsLoadingSuspendedSessions.value = false;
    mockSessionTabs.value = [];
    mockSessionTabsWithStatus.value = [];
    mockActiveSession.value = null;
  });

  describe('初始状态', () => {
    it('应该正确导出 state', async () => {
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      // sessions 是 shallowRef，Pinia 会保持引用
      expect(store.sessions).toBeDefined();
      // Pinia 自动解包 ref，直接访问值即可
      expect(store.activeSessionId).toBeNull();
      expect(store.isRdpModalOpen).toBe(false);
      expect(store.rdpConnectionInfo).toBeNull();
      expect(store.isVncModalOpen).toBe(false);
      expect(store.vncConnectionInfo).toBeNull();
      expect(store.suspendedSshSessions).toEqual([]);
      expect(store.isLoadingSuspendedSessions).toBe(false);
    });
  });

  describe('Getters', () => {
    it('应该正确导出 getters', async () => {
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      // getters 是 computed 属性，返回值而非引用，检查类型和初始值
      expect(Array.isArray(store.sessionTabs)).toBe(true);
      expect(Array.isArray(store.sessionTabsWithStatus)).toBe(true);
      expect(store.activeSession).toBeNull();
    });
  });

  describe('Session Actions', () => {
    it('openNewSession 应该调用 sessionActions.openNewSession', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.openNewSession('1');

      expect(sessionActions.openNewSession).toHaveBeenCalledTimes(1);
    });

    it('activateSession 应该调用 sessionActions.activateSession', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.activateSession('session-123');

      expect(sessionActions.activateSession).toHaveBeenCalledWith('session-123');
    });

    it('closeSession 应该调用 sessionActions.closeSession', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.closeSession('session-123');

      expect(sessionActions.closeSession).toHaveBeenCalledWith('session-123');
    });

    it('cleanupAllSessions 应该调用 sessionActions.cleanupAllSessions', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.cleanupAllSessions();

      expect(sessionActions.cleanupAllSessions).toHaveBeenCalledTimes(1);
    });
  });

  describe('Modal Actions', () => {
    it('openRdpModal 应该调用 modalActions.openRdpModal', async () => {
      const modalActions = await import('./session/actions/modalActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();
      const mockConnection = {
        id: 1,
        name: 'Test RDP',
        host: '192.168.1.2',
        port: 3389,
        type: 'RDP' as const,
        username: 'user',
        auth_method: 'password' as const,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_connected_at: null,
      };

      store.openRdpModal(mockConnection);

      expect(modalActions.openRdpModal).toHaveBeenCalledWith(mockConnection);
    });

    it('closeRdpModal 应该调用 modalActions.closeRdpModal', async () => {
      const modalActions = await import('./session/actions/modalActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.closeRdpModal();

      expect(modalActions.closeRdpModal).toHaveBeenCalledTimes(1);
    });

    it('openVncModal 应该调用 modalActions.openVncModal', async () => {
      const modalActions = await import('./session/actions/modalActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();
      const mockConnection = {
        id: 3,
        name: 'Test VNC',
        host: '192.168.1.3',
        port: 5900,
        type: 'VNC' as const,
        username: 'user',
        auth_method: 'password' as const,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_connected_at: null,
      };

      store.openVncModal(mockConnection);

      expect(modalActions.openVncModal).toHaveBeenCalledWith(mockConnection);
    });

    it('closeVncModal 应该调用 modalActions.closeVncModal', async () => {
      const modalActions = await import('./session/actions/modalActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.closeVncModal();

      expect(modalActions.closeVncModal).toHaveBeenCalledTimes(1);
    });
  });

  describe('SFTP Manager Actions', () => {
    it('getOrCreateSftpManager 应该调用 sftpManagerActions.getOrCreateSftpManager', async () => {
      const sftpManagerActions = await import('./session/actions/sftpManagerActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.getOrCreateSftpManager('session-123', 'instance-1', '/home');

      expect(sftpManagerActions.getOrCreateSftpManager).toHaveBeenCalledWith(
        'session-123',
        'instance-1',
        expect.any(Object),
        '/home'
      );
    });

    it('removeSftpManager 应该调用 sftpManagerActions.removeSftpManager', async () => {
      const sftpManagerActions = await import('./session/actions/sftpManagerActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.removeSftpManager('session-123', 'instance-1');

      expect(sftpManagerActions.removeSftpManager).toHaveBeenCalledWith(
        'session-123',
        'instance-1'
      );
    });
  });

  describe('Command Input Actions', () => {
    it('updateSessionCommandInput 应该调用 commandInputActions.updateSessionCommandInput', async () => {
      const commandInputActions = await import('./session/actions/commandInputActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.updateSessionCommandInput('session-123', 'ls -la');

      expect(commandInputActions.updateSessionCommandInput).toHaveBeenCalledWith(
        'session-123',
        'ls -la'
      );
    });
  });

  describe('SSH Suspend Actions', () => {
    it('应该导出 SSH 挂起相关 actions', async () => {
      const _sshSuspendActions = await import('./session/actions/sshSuspendActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(typeof store.requestStartSshSuspend).toBe('function');
      expect(typeof store.requestUnmarkSshSuspend).toBe('function');
      expect(typeof store.fetchSuspendedSshSessions).toBe('function');
      expect(typeof store.resumeSshSession).toBe('function');
      expect(typeof store.terminateAndRemoveSshSession).toBe('function');
      expect(typeof store.removeSshSessionEntry).toBe('function');
      expect(typeof store.editSshSessionName).toBe('function');
      expect(typeof store.exportSshSessionLog).toBe('function');
    });
  });

  describe('handleConnectRequest', () => {
    it('RDP 类型连接应该调用 openRdpModal', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();
      const rdpConnection = {
        id: 2,
        name: 'Test RDP',
        host: '192.168.1.2',
        port: 3389,
        type: 'RDP' as const,
        username: 'user',
        auth_method: 'password' as const,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_connected_at: null,
      };

      store.handleConnectRequest(rdpConnection);

      expect(sessionActions.handleConnectRequest).toHaveBeenCalledWith(
        rdpConnection,
        expect.objectContaining({
          openRdpModalAction: expect.any(Function),
          openVncModalAction: expect.any(Function),
        })
      );
    });
  });
});
