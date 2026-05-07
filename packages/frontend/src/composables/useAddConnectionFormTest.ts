/**
 * 连接表单 - 测试连接处理器模块
 * 职责：测试连接、延迟颜色计算、测试按钮文本
 */
import { computed } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import type { ConnectionInfo } from '../stores/connections.store';
import type { useUiNotificationsStore } from '../stores/uiNotifications.store';
import type { TranslateFn } from '../types/i18n.types';
import { extractErrorMessage } from '../utils/errorExtractor';
import { log } from '@/utils/log';

/** 测试连接响应结构 */
interface TestConnectionResponse {
  success: boolean;
  latency?: number;
  message?: string;
}

/** 测试连接处理器依赖 */
export interface TestDeps {
  formData: {
    host: string;
    port: number;
    username: string;
    auth_method: 'password' | 'key';
    password: string;
    selected_ssh_key_id: number | null;
    proxy_id: number | null;
  };
  isEditMode: ComputedRef<boolean>;
  connectionToEdit: Ref<ConnectionInfo | null>;
  testStatus: Ref<'idle' | 'testing' | 'success' | 'error'>;
  testResult: Ref<string | number | null>;
  testLatency: Ref<number | null>;
  uiNotificationsStore: ReturnType<typeof useUiNotificationsStore>;
  apiClient: {
    post: (url: string, data?: unknown) => Promise<{ data: TestConnectionResponse }>;
  };
  t: TranslateFn;
}

/**
 * 创建测试连接处理器及关联计算属性
 * handleTestConnection: 发起连接测试
 * latencyColor: 根据延迟值返回对应颜色
 * testButtonText: 根据测试状态返回按钮文本
 */
export function createTestConnection(deps: TestDeps) {
  const {
    formData,
    isEditMode,
    connectionToEdit,
    testStatus,
    testResult,
    testLatency,
    uiNotificationsStore,
    apiClient,
    t,
  } = deps;

  const handleTestConnection = async () => {
    testStatus.value = 'testing';
    testResult.value = null;
    testLatency.value = null;

    try {
      let response;
      if (isEditMode.value && connectionToEdit.value) {
        response = await apiClient.post(`/connections/${connectionToEdit.value.id}/test`);
      } else {
        const dataToSend = {
          host: formData.host,
          port: formData.port,
          username: formData.username,
          auth_method: formData.auth_method,
          password: formData.auth_method === 'password' ? formData.password : undefined,
          proxy_id: formData.proxy_id || null,
          ssh_key_id: formData.auth_method === 'key' ? formData.selected_ssh_key_id : undefined,
        };

        if (
          !dataToSend.host ||
          !dataToSend.port ||
          !dataToSend.username ||
          !dataToSend.auth_method
        ) {
          throw new Error(t('connections.test.errorMissingFields'));
        }
        if (dataToSend.auth_method === 'password' && !formData.password) {
          throw new Error(t('connections.form.errorPasswordRequired'));
        }
        if (dataToSend.auth_method === 'key' && !dataToSend.ssh_key_id) {
          throw new Error(t('connections.form.errorSshKeyRequired'));
        }
        response = await apiClient.post('/connections/test-unsaved', dataToSend);
      }

      if (response.data.success) {
        testStatus.value = 'success';
        testLatency.value = response.data.latency ?? null;
        testResult.value = `${response.data.latency} ms`;
      } else {
        testStatus.value = 'error';
        const errorMessage = response.data.message || t('connections.test.errorUnknown');
        testResult.value = errorMessage;
        uiNotificationsStore.showError(errorMessage);
      }
    } catch (error: unknown) {
      log.error('测试连接失败:', error);
      testStatus.value = 'error';
      const errorMessageToShow = extractErrorMessage(error, t('connections.test.errorNetwork'));
      testResult.value = errorMessageToShow;
      uiNotificationsStore.showError(errorMessageToShow);
    }
  };

  // 计算延迟颜色
  const latencyColor = computed(() => {
    if (testStatus.value !== 'success' || testLatency.value === null) {
      return 'inherit';
    }
    const latency = testLatency.value;
    if (latency < 100) return 'var(--color-success, #28a745)';
    if (latency < 500) return 'var(--color-warning, #ffc107)';
    return 'var(--color-danger, #dc3545)';
  });

  // 计算测试按钮文本
  const testButtonText = computed(() => {
    if (testStatus.value === 'testing') {
      return t('connections.form.testing');
    }
    return t('connections.form.testConnection');
  });

  return { handleTestConnection, latencyColor, testButtonText };
}
