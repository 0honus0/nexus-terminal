import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { useDialogStore } from './dialog.store';

describe('dialog.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('visible 应该为 false', () => {
      const store = useDialogStore();
      // Pinia 解包 ref，state 是普通对象
      expect(store.state.visible).toBe(false);
    });

    it('title 应该为空字符串', () => {
      const store = useDialogStore();
      expect(store.state.title).toBe('');
    });

    it('message 应该为空字符串', () => {
      const store = useDialogStore();
      expect(store.state.message).toBe('');
    });

    it('isLoading 应该为 false', () => {
      const store = useDialogStore();
      expect(store.state.isLoading).toBe(false);
    });

    it('confirmText 应该有默认值', () => {
      const store = useDialogStore();
      expect(store.state.confirmText).toBeTruthy();
    });

    it('cancelText 应该有默认值', () => {
      const store = useDialogStore();
      expect(store.state.cancelText).toBeTruthy();
    });
  });

  describe('showDialog', () => {
    it('调用后应设置 visible 为 true', () => {
      const store = useDialogStore();
      store.showDialog({ title: '确认', message: '是否继续？' });

      expect(store.state.visible).toBe(true);
    });

    it('应正确设置 title 和 message', () => {
      const store = useDialogStore();
      store.showDialog({ title: '删除确认', message: '确定要删除此项吗？' });

      expect(store.state.title).toBe('删除确认');
      expect(store.state.message).toBe('确定要删除此项吗？');
    });

    it('应支持自定义 confirmText 和 cancelText', () => {
      const store = useDialogStore();
      store.showDialog({
        title: '操作',
        message: '提示信息',
        confirmText: '好的',
        cancelText: '算了',
      });

      expect(store.state.confirmText).toBe('好的');
      expect(store.state.cancelText).toBe('算了');
    });

    it('返回的 Promise 不应在调用 handleConfirm 前已解决', () => {
      const store = useDialogStore();
      const promise = store.showDialog({ title: '提示', message: '信息' });

      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);
    });

    it('应重置 isLoading 为 false', () => {
      const store = useDialogStore();
      store.setLoading(true);
      store.showDialog({ title: '提示', message: '信息' });

      expect(store.state.isLoading).toBe(false);
    });

    it('应存储 resolvePromise 和 rejectPromise', () => {
      const store = useDialogStore();
      store.showDialog({ title: '提示', message: '信息' });

      expect(typeof store.state.resolvePromise).toBe('function');
      expect(typeof store.state.rejectPromise).toBe('function');
    });
  });

  describe('handleConfirm', () => {
    it('调用后应设置 visible 为 false', async () => {
      const store = useDialogStore();
      store.showDialog({ title: '提示', message: '信息' });
      await store.handleConfirm();

      expect(store.state.visible).toBe(false);
    });

    it('confirm 后应 resolve 为 true', async () => {
      const store = useDialogStore();
      const promise = store.showDialog({ title: '提示', message: '信息' });

      const confirmPromise = store.handleConfirm();
      const result = await promise;
      expect(result).toBe(true);
      await confirmPromise;
    });
  });

  describe('handleCancel', () => {
    it('调用后应设置 visible 为 false', () => {
      const store = useDialogStore();
      store.showDialog({ title: '提示', message: '信息' });
      store.handleCancel();

      expect(store.state.visible).toBe(false);
    });

    it('cancel 后应 resolve 为 false', async () => {
      const store = useDialogStore();
      const promise = store.showDialog({ title: '提示', message: '信息' });

      store.handleCancel();

      const result = await promise;
      expect(result).toBe(false);
    });
  });

  describe('setLoading', () => {
    it('传入 true 应设置 isLoading 为 true', () => {
      const store = useDialogStore();
      store.setLoading(true);

      expect(store.state.isLoading).toBe(true);
    });

    it('传入 false 应设置 isLoading 为 false', () => {
      const store = useDialogStore();
      store.setLoading(true);
      store.setLoading(false);

      expect(store.state.isLoading).toBe(false);
    });
  });

  describe('完整对话流程', () => {
    it('显示对话框 → 设置 loading → 确认 → 关闭', async () => {
      const store = useDialogStore();
      const promise = store.showDialog({
        title: '删除确认',
        message: '确定要删除吗？',
        confirmText: '删除',
        cancelText: '取消',
      });

      expect(store.state.visible).toBe(true);
      expect(store.state.title).toBe('删除确认');

      store.setLoading(true);
      expect(store.state.isLoading).toBe(true);

      await store.handleConfirm();

      expect(store.state.visible).toBe(false);

      const result = await promise;
      expect(result).toBe(true);
    });

    it('显示对话框 → 取消 → 关闭', async () => {
      const store = useDialogStore();
      const promise = store.showDialog({
        title: '操作确认',
        message: '是否继续？',
      });

      store.handleCancel();

      const result = await promise;
      expect(result).toBe(false);
      expect(store.state.visible).toBe(false);
    });

    it('多次 showDialog 应该只保留最后一次的状态', async () => {
      const store = useDialogStore();
      store.showDialog({ title: '对话框1', message: '信息1' });

      store.showDialog({ title: '对话框2', message: '信息2' });

      expect(store.state.title).toBe('对话框2');
      expect(store.state.message).toBe('信息2');

      store.handleCancel();

      const promise2 = store.showDialog({ title: '对话框3', message: '信息3' });
      store.handleConfirm();

      const result2 = await promise2;
      expect(result2).toBe(true);
    });
  });

  describe('边界条件', () => {
    it('在没有 showDialog 时调用 handleConfirm 不应抛出异常', async () => {
      const store = useDialogStore();
      await expect(store.handleConfirm()).resolves.not.toThrow();
    });

    it('在没有 showDialog 时调用 handleCancel 不应抛出异常', () => {
      const store = useDialogStore();
      expect(() => store.handleCancel()).not.toThrow();
    });

    it('多个 store 实例应共享同一份 state', () => {
      const store1 = useDialogStore();
      const store2 = useDialogStore();

      store1.showDialog({ title: '测试', message: '共享状态' });

      expect(store2.state.visible).toBe(true);
      expect(store2.state.title).toBe('测试');
    });

    it('showDialog 应重置 isLoading 为 false', () => {
      const store = useDialogStore();
      store.setLoading(true);
      store.showDialog({ title: '提示', message: '信息' });

      expect(store.state.isLoading).toBe(false);
    });
  });
});
