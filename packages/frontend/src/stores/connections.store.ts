import { defineStore } from 'pinia';
import apiClient from '../utils/apiClient';
import { cacheManager, CACHE_KEYS, CACHE_CONFIG } from '../utils/cacheManager';
import { extractErrorMessage } from '../utils/errorExtractor';

// 定义连接信息接口 (与后端对应，不含敏感信息)
export interface ConnectionInfo {
  id: number;
  name: string;
  type: 'SSH' | 'RDP' | 'VNC'; // Use uppercase to match backend data
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'key';
  proxy_id?: number | null; // 关联的代理 ID (可选)
  proxy_type?: 'proxy' | 'jump' | null;
  tag_ids?: number[]; // 关联的标签 ID 数组 (可选)
  ssh_key_id?: number | null; // +++ 关联的 SSH 密钥 ID (可选) +++
  created_at: number;
  updated_at: number;
  last_connected_at: number | null;
  notes?: string | null;
  vncPassword?: string; // VNC specific password
  jump_chain?: number[] | null;
  force_keyboard_interactive?: boolean;
}

// 定义 Store State 的接口
interface ConnectionsState {
  connections: ConnectionInfo[];
  isLoading: boolean;
  error: string | null;
}

const isUnauthorizedError = (err: unknown): boolean => {
  const maybeError = err as { response?: { status?: number } };
  return maybeError.response?.status === 401;
};

// 定义 Pinia Store
export const useConnectionsStore = defineStore('connections', {
  state: (): ConnectionsState => ({
    connections: [],
    isLoading: false,
    error: null,
  }),
  actions: {
    // 获取连接列表 Action (带缓存)
    async fetchConnections() {
      const cacheOptions = CACHE_CONFIG[CACHE_KEYS.CONNECTIONS];
      this.error = null;

      // 1. 尝试从缓存加载（CacheManager 自动处理版本校验和 TTL）
      const cachedData = cacheManager.get<ConnectionInfo[]>(
        CACHE_KEYS.CONNECTIONS,
        [],
        cacheOptions
      );
      if (cachedData.length > 0) {
        this.connections = cachedData;
        this.isLoading = false;
      } else {
        this.isLoading = true;
      }

      // 2. 后台获取最新数据
      this.isLoading = true;
      try {
        const response = await apiClient.get<ConnectionInfo[]>('/connections');
        const freshData = response.data;

        // 3. 对比并更新
        const currentDataString = JSON.stringify(this.connections);
        const freshDataString = JSON.stringify(freshData);
        if (currentDataString !== freshDataString) {
          this.connections = freshData;
          cacheManager.set(CACHE_KEYS.CONNECTIONS, freshData, cacheOptions);
        }
        this.error = null;
      } catch (err: unknown) {
        console.error('[ConnectionsStore] 获取连接列表失败:', err);
        this.error = extractErrorMessage(err, '获取连接列表时发生未知错误。');
        if (isUnauthorizedError(err)) {
          console.warn('[ConnectionsStore] 未授权，需要登录才能获取连接列表。');
        }
      } finally {
        this.isLoading = false;
      }
    },

    // 添加新连接 Action (添加后应清除缓存或重新获取)
    // 更新参数类型以接受新的认证字段
    async addConnection(newConnectionData: {
      name: string;
      type: 'SSH' | 'RDP' | 'VNC'; // Use uppercase
      host: string;
      port: number;
      username: string;
      auth_method: 'password' | 'key'; // SSH specific
      password?: string; // SSH password or general password
      private_key?: string; // SSH specific
      passphrase?: string; // SSH specific
      vncPassword?: string; // VNC specific password
      proxy_id?: number | null;
      proxy_type?: 'proxy' | 'jump' | null;
      tag_ids?: number[]; // 允许传入 tag_ids
      jump_chain?: number[] | null;
    }) {
      this.isLoading = true;
      this.error = null;
      try {
        await apiClient.post<{ message: string; connection: ConnectionInfo }>(
          '/connections',
          newConnectionData
        ); // 使用 apiClient
        // 添加成功后，清除缓存以便下次获取最新数据
        cacheManager.remove(CACHE_KEYS.CONNECTIONS);
        // 可以选择重新获取整个列表，或者仅在本地添加
        // this.connections.unshift(response.data.connection); // 本地添加可能导致与缓存不一致，建议重新获取
        await this.fetchConnections(); // 推荐重新获取以保证数据一致性
        return true; // 表示成功
      } catch (err: unknown) {
        console.error('添加连接失败:', err);
        this.error = extractErrorMessage(err, '添加连接时发生未知错误。');
        if (isUnauthorizedError(err)) {
          console.warn('未授权，需要登录才能添加连接。');
        }
        return false; // 表示失败
      } finally {
        this.isLoading = false;
      }
    },

    // 更新连接 Action
    // 更新参数类型以包含 proxy_id 和 tag_ids
    // Update parameter type to include 'type' and VNC fields
    async updateConnection(
      connectionId: number,
      updatedData: Partial<
        Omit<ConnectionInfo, 'id' | 'created_at' | 'updated_at' | 'last_connected_at'> & {
          type?: 'SSH' | 'RDP' | 'VNC';
          password?: string;
          private_key?: string;
          passphrase?: string;
          vncPassword?: string;
          proxy_id?: number | null;
          proxy_type?: 'proxy' | 'jump' | null;
          tag_ids?: number[];
          jump_chain?: number[] | null;
        }
      >
    ) {
      this.isLoading = true;
      this.error = null;
      try {
        // 发送 PUT 请求到 /api/v1/connections/:id
        // 注意：后端 API 需要支持接收这些字段并进行更新
        const response = await apiClient.put<{ message: string; connection: ConnectionInfo }>(
          `/connections/${connectionId}`,
          updatedData
        ); // 使用 apiClient

        // 更新成功后，在列表中找到并更新对应的连接信息
        const index = this.connections.findIndex((conn) => conn.id === connectionId);
        if (index !== -1) {
          // 使用更新后的完整信息替换旧信息
          // 注意：后端返回的 connection 可能不包含敏感信息，但应包含更新后的非敏感字段
          this.connections[index] = { ...this.connections[index], ...response.data.connection };
        } else {
          // 如果本地找不到，fetchConnections 会处理
          // await this.fetchConnections(); // fetchConnections 内部会处理
        }
        // 更新成功后，清除缓存以便下次获取最新数据
        cacheManager.remove(CACHE_KEYS.CONNECTIONS);
        // 重新获取以确保数据同步（如果上面没有找到 index 并调用 fetchConnections）
        if (index !== -1) {
          // 只有在本地找到并更新后才需要手动触发刷新缓存
          await this.fetchConnections(); // 重新获取以更新缓存和状态
        }
        return true; // 表示成功
      } catch (err: unknown) {
        console.error(`更新连接 ${connectionId} 失败:`, err);
        this.error = extractErrorMessage(err, '更新连接时发生未知错误。');
        if (isUnauthorizedError(err)) {
          console.warn('未授权，需要登录才能更新连接。');
        }
        return false; // 表示失败
      } finally {
        this.isLoading = false;
      }
    },

    // 删除连接 Action
    async deleteConnection(connectionId: number) {
      this.isLoading = true; // 可以为删除操作单独设置加载状态
      this.error = null;
      try {
        // 发送 DELETE 请求到 /api/v1/connections/:id
        await apiClient.delete(`/connections/${connectionId}`); // 使用 apiClient

        // 删除成功后，清除缓存以便下次获取最新数据
        cacheManager.remove(CACHE_KEYS.CONNECTIONS);
        // 从本地列表中移除该连接
        this.connections = this.connections.filter((conn) => conn.id !== connectionId);
        // 可以选择重新获取，但 filter 已经更新了本地状态，下次 fetch 会自动更新缓存
        // await this.fetchConnections();
        return true; // 表示成功
      } catch (err: unknown) {
        console.error(`删除连接 ${connectionId} 失败:`, err);
        this.error = extractErrorMessage(err, '删除连接时发生未知错误。');
        if (isUnauthorizedError(err)) {
          console.warn('未授权，需要登录才能删除连接。');
        }
        // 即使删除失败，也可能需要通知用户
        return false; // 表示失败
      } finally {
        this.isLoading = false;
      }
    },

    // 批量删除连接
    async deleteBatchConnections(connectionIds: number[]): Promise<boolean> {
      if (!connectionIds || connectionIds.length === 0) {
        console.warn('[ConnectionsStore] deleteBatchConnections called with no IDs.');
        return true; // 没有要删除的，视为成功
      }
      this.isLoading = true; // 标记整个批量删除操作正在进行
      this.error = null;
      let allSucceeded = true;
      const individualErrors: string[] = [];

      for (const id of connectionIds) {
        try {
          // 调用现有的 deleteConnection 方法
          const success = await this.deleteConnection(id);
          if (!success) {
            allSucceeded = false;
            if (this.error) {
              individualErrors.push(`删除连接 ID ${id} 失败: ${this.error}`);
            } else {
              individualErrors.push(`删除连接 ID ${id} 失败 (未知原因)`);
            }
            this.error = null;
          }
        } catch (e: unknown) {
          // 捕获 deleteConnection 调用本身可能抛出的意外错误
          allSucceeded = false;
          const errorMessage = extractErrorMessage(e, '未知错误');
          individualErrors.push(`调用删除连接 ID ${id} 时发生意外错误: ${errorMessage}`);
          console.error(
            `[ConnectionsStore] Unexpected error calling deleteConnection for ID ${id}`,
            e
          );
        }
      }

      if (!allSucceeded) {
        this.error = `批量删除操作中部分连接未能成功删除。详情: ${individualErrors.join('; ')}`;
        console.error(
          '[ConnectionsStore] Batch delete operation completed with one or more failures.'
        );
      } else {
        // 如果所有操作都成功，确保 this.error 为 null
        this.error = null;
      }

      this.isLoading = false;
      return allSucceeded;
    },

    // 测试连接 Action
    async testConnection(
      connectionId: number
    ): Promise<{ success: boolean; message?: string; latency?: number }> {
      // 注意：这里不改变 isLoading 状态，或者可以引入单独的 testing 状态
      // this.isLoading = true;
      // this.error = null;
      try {
        // 假设后端返回 { success: boolean; message: string; latency?: number }
        const response = await apiClient.post<{
          success: boolean;
          message: string;
          latency?: number;
        }>(`/connections/${connectionId}/test`); // 使用 apiClient
        return {
          success: response.data.success,
          message: response.data.message,
          latency: response.data.latency,
        };
      } catch (err: unknown) {
        console.error(`测试连接 ${connectionId} 失败:`, err);
        if (isUnauthorizedError(err)) {
          console.warn('未授权，需要登录才能测试连接。');
        }
        return { success: false, message: extractErrorMessage(err, '测试连接时发生未知错误。') };
      } finally {
        // this.isLoading = false;
      }
    },

    // 克隆连接 Action (调用后端克隆接口)
    async cloneConnection(originalId: number, newName: string): Promise<boolean> {
      this.isLoading = true; // 可以考虑为克隆操作设置单独的加载状态
      this.error = null;
      try {
        // 调用后端的克隆接口，例如 POST /connections/:id/clone
        // 请求体可以包含新名称等信息
        // 假设后端接口需要 { name: newName } 作为请求体
        await apiClient.post(`/connections/${originalId}/clone`, { name: newName });

        // 克隆成功后，清除缓存并重新获取列表以显示新连接
        cacheManager.remove(CACHE_KEYS.CONNECTIONS);
        await this.fetchConnections(); // 重新获取以保证数据一致性
        return true; // 表示成功
      } catch (err: unknown) {
        console.error(`克隆连接 ${originalId} 失败:`, err);
        this.error = extractErrorMessage(err, '克隆连接时发生未知错误。');
        if (isUnauthorizedError(err)) {
          console.warn('未授权，需要登录才能克隆连接。');
        }
        return false; // 表示失败
      } finally {
        this.isLoading = false;
      }
    },

    // +++ 为多个连接添加一个标签 (调用新的后端 API) +++
    async addTagToConnectionsAction(connectionIds: number[], tagId: number): Promise<boolean> {
      if (connectionIds.length === 0) return true; // 没有连接需要更新，直接返回成功

      this.isLoading = true; // 可以考虑为批量操作设置单独状态
      this.error = null;
      try {
        // 调用新的后端 API POST /connections/add-tag
        await apiClient.post('/connections/add-tag', {
          connection_ids: connectionIds,
          tag_id: tagId,
        });

        // 更新成功后，清除缓存并重新获取以保证数据一致性
        cacheManager.remove(CACHE_KEYS.CONNECTIONS);
        await this.fetchConnections();
        return true; // 表示成功
      } catch (err: unknown) {
        console.error(`为连接 ${connectionIds.join(', ')} 添加标签 ${tagId} 失败:`, err);
        this.error = extractErrorMessage(err, '为连接添加标签时发生未知错误。');
        if (isUnauthorizedError(err)) {
          console.warn('未授权，需要登录才能为连接添加标签。');
        }
        return false; // 表示失败
      } finally {
        this.isLoading = false;
      }
    },

    // (保留) 更新单个连接的标签 (如果仍有需要)
    async updateConnectionTags(connectionId: number, tagIds: number[]): Promise<boolean> {
      this.isLoading = true;
      this.error = null;
      try {
        // 注意：此 API 端点可能已在后端移除或更改
        await apiClient.put(`/connections/${connectionId}/tags`, { tag_ids: tagIds });
        cacheManager.remove(CACHE_KEYS.CONNECTIONS);
        await this.fetchConnections();
        return true;
      } catch (err: unknown) {
        console.error(`更新连接 ${connectionId} 的标签失败:`, err);
        this.error = extractErrorMessage(err, '更新连接标签时发生未知错误。');
        return false;
      } finally {
        this.isLoading = false;
      }
    },

    // +++ 获取 VNC 会话令牌 +++
    async getVncSessionToken(
      connectionId: number,
      width?: number,
      height?: number
    ): Promise<string | null> {
      // this.isLoading = true; // 考虑是否需要独立的加载状态，或者由调用方处理
      // this.error = null;
      try {
        let apiUrl = `/connections/${connectionId}/vnc-session`;
        const params = new URLSearchParams();
        if (width !== undefined) {
          params.append('width', String(width));
        }
        if (height !== undefined) {
          params.append('height', String(height));
        }
        const queryString = params.toString();
        if (queryString) {
          apiUrl += `?${queryString}`;
        }
        // 调用后端 API POST /connections/:id/vnc-session (现在带有可选的 width/height 查询参数)
        const response = await apiClient.post<{ token: string }>(apiUrl);
        return response.data.token;
      } catch (err: unknown) {
        console.error(`获取 VNC 会话令牌失败 (连接 ID: ${connectionId}):`, err);
        // this.error = err.response?.data?.message || err.message || '获取 VNC 会话令牌时发生未知错误。';
        if (isUnauthorizedError(err)) {
          console.warn('未授权，需要登录才能获取 VNC 会话令牌。');
        }
        // 对于这种一次性获取数据的操作，错误通常由调用方处理并显示给用户
        throw err; // 重新抛出错误，让调用方处理
      } finally {
        // this.isLoading = false;
      }
    },
  },
});
