import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { AlertDialogOptions, ConfirmDialogOptions } from '../model';

type DialogKind = 'confirm' | 'alert';

interface DialogState {
  visible: boolean;
  kind: DialogKind;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive: boolean;
  loading: boolean;
}

export const useDialogStore = defineStore('shared-dialog', () => {
  const state = reactive<DialogState>({
    visible: false,
    kind: 'confirm',
    title: undefined,
    message: '',
    confirmText: undefined,
    cancelText: undefined,
    destructive: false,
    loading: false,
  });

  let resolveCurrent: ((value: boolean) => void) | undefined;

  const begin = (): Promise<boolean> => {
    if (resolveCurrent) resolveCurrent(false);
    state.visible = true;
    state.loading = false;
    return new Promise<boolean>((resolve) => {
      resolveCurrent = resolve;
    });
  };

  const confirm = (options: ConfirmDialogOptions): Promise<boolean> => {
    state.kind = 'confirm';
    state.title = options.title;
    state.message = options.message;
    state.confirmText = options.confirmText;
    state.cancelText = options.cancelText;
    state.destructive = Boolean(options.destructive);
    return begin();
  };

  const alert = async (options: AlertDialogOptions): Promise<void> => {
    state.kind = 'alert';
    state.title = options.title;
    state.message = options.message;
    state.confirmText = options.okText;
    state.cancelText = undefined;
    state.destructive = false;
    await begin();
  };

  const finish = (result: boolean): void => {
    resolveCurrent?.(result);
    resolveCurrent = undefined;
    state.visible = false;
    state.loading = false;
  };

  return {
    state,
    confirm,
    alert,
    accept: () => finish(true),
    cancel: () => finish(false),
    setLoading: (loading: boolean) => {
      state.loading = loading;
    },
  };
});
