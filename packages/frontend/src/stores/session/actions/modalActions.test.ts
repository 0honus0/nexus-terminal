import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock state 模块 — 使用独立的 ref 以便直接验证状态变更
const mockIsRdpModalOpen = ref(false);
const mockRdpConnectionInfo = ref(null);
const mockIsVncModalOpen = ref(false);
const mockVncConnectionInfo = ref(null);

vi.mock('../state', () => ({
  get isRdpModalOpen() {
    return mockIsRdpModalOpen;
  },
  get rdpConnectionInfo() {
    return mockRdpConnectionInfo;
  },
  get isVncModalOpen() {
    return mockIsVncModalOpen;
  },
  get vncConnectionInfo() {
    return mockVncConnectionInfo;
  },
}));

import { openRdpModal, closeRdpModal, openVncModal, closeVncModal } from './modalActions';
import type { ConnectionInfo } from '../../connections.store';

const createMockConnection = (overrides: Partial<ConnectionInfo> = {}): ConnectionInfo =>
  ({
    id: overrides.id ?? 1,
    name: overrides.name ?? '测试连接',
    type: overrides.type ?? ('SSH' as const),
    host: overrides.host ?? '192.168.1.1',
    port: overrides.port ?? 22,
    username: overrides.username ?? 'root',
    auth_method: overrides.auth_method ?? ('password' as const),
    created_at: Date.now(),
    updated_at: Date.now(),
    last_connected_at: null,
  }) as ConnectionInfo;

describe('session/actions/modalActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRdpModalOpen.value = false;
    mockRdpConnectionInfo.value = null;
    mockIsVncModalOpen.value = false;
    mockVncConnectionInfo.value = null;
  });

  describe('RDP Modal Actions', () => {
    it('openRdpModal 应该设置 rdpConnectionInfo 和 isRdpModalOpen', () => {
      const conn = createMockConnection({ type: 'RDP', port: 3389 });
      openRdpModal(conn);

      expect(mockIsRdpModalOpen.value).toBe(true);
      expect(mockRdpConnectionInfo.value).toEqual(conn);
    });

    it('closeRdpModal 应该重置 isRdpModalOpen 和 rdpConnectionInfo', () => {
      mockIsRdpModalOpen.value = true;
      mockRdpConnectionInfo.value = createMockConnection({ type: 'RDP' });

      closeRdpModal();

      expect(mockIsRdpModalOpen.value).toBe(false);
      expect(mockRdpConnectionInfo.value).toBeNull();
    });

    it('连续打开和关闭 RDP Modal 应正确切换状态', () => {
      const conn = createMockConnection({ type: 'RDP' });

      openRdpModal(conn);
      expect(mockIsRdpModalOpen.value).toBe(true);

      closeRdpModal();
      expect(mockIsRdpModalOpen.value).toBe(false);
      expect(mockRdpConnectionInfo.value).toBeNull();
    });

    it('打开新的 RDP Modal 应替换之前的连接信息', () => {
      const conn1 = createMockConnection({ id: 1, name: '服务器 A' });
      const conn2 = createMockConnection({ id: 2, name: '服务器 B' });

      openRdpModal(conn1);
      expect(mockRdpConnectionInfo.value?.name).toBe('服务器 A');

      openRdpModal(conn2);
      expect(mockRdpConnectionInfo.value?.name).toBe('服务器 B');
      expect(mockIsRdpModalOpen.value).toBe(true);
    });
  });

  describe('VNC Modal Actions', () => {
    it('openVncModal 应该设置 vncConnectionInfo 和 isVncModalOpen', () => {
      const conn = createMockConnection({ type: 'VNC', port: 5900 });
      openVncModal(conn);

      expect(mockIsVncModalOpen.value).toBe(true);
      expect(mockVncConnectionInfo.value).toEqual(conn);
    });

    it('closeVncModal 应该重置 isVncModalOpen 和 vncConnectionInfo', () => {
      mockIsVncModalOpen.value = true;
      mockVncConnectionInfo.value = createMockConnection({ type: 'VNC' });

      closeVncModal();

      expect(mockIsVncModalOpen.value).toBe(false);
      expect(mockVncConnectionInfo.value).toBeNull();
    });

    it('连续打开和关闭 VNC Modal 应正确切换状态', () => {
      const conn = createMockConnection({ type: 'VNC' });

      openVncModal(conn);
      expect(mockIsVncModalOpen.value).toBe(true);

      closeVncModal();
      expect(mockIsVncModalOpen.value).toBe(false);
      expect(mockVncConnectionInfo.value).toBeNull();
    });

    it('打开新的 VNC Modal 应替换之前的连接信息', () => {
      const conn1 = createMockConnection({ id: 1, name: 'VNC-A' });
      const conn2 = createMockConnection({ id: 2, name: 'VNC-B' });

      openVncModal(conn1);
      expect(mockVncConnectionInfo.value?.name).toBe('VNC-A');

      openVncModal(conn2);
      expect(mockVncConnectionInfo.value?.name).toBe('VNC-B');
    });
  });

  describe('RDP 和 VNC Modal 互不影响', () => {
    it('打开 RDP Modal 不应影响 VNC Modal 状态', () => {
      const rdpConn = createMockConnection({ type: 'RDP' });
      openRdpModal(rdpConn);

      expect(mockIsRdpModalOpen.value).toBe(true);
      expect(mockIsVncModalOpen.value).toBe(false);
      expect(mockVncConnectionInfo.value).toBeNull();
    });

    it('同时打开 RDP 和 VNC Modal', () => {
      const rdpConn = createMockConnection({ type: 'RDP', name: 'RDP-Server' });
      const vncConn = createMockConnection({ type: 'VNC', name: 'VNC-Server' });

      openRdpModal(rdpConn);
      openVncModal(vncConn);

      expect(mockIsRdpModalOpen.value).toBe(true);
      expect(mockIsVncModalOpen.value).toBe(true);
      expect(mockRdpConnectionInfo.value?.name).toBe('RDP-Server');
      expect(mockVncConnectionInfo.value?.name).toBe('VNC-Server');
    });

    it('关闭一个 Modal 不应影响另一个', () => {
      const rdpConn = createMockConnection({ type: 'RDP' });
      const vncConn = createMockConnection({ type: 'VNC' });

      openRdpModal(rdpConn);
      openVncModal(vncConn);
      closeRdpModal();

      expect(mockIsRdpModalOpen.value).toBe(false);
      expect(mockIsVncModalOpen.value).toBe(true);
      expect(mockVncConnectionInfo.value).toEqual(vncConn);
    });
  });
});
