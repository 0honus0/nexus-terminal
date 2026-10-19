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
	let detachAbort: (() => void) | undefined;

	const begin = (signal?: AbortSignal): Promise<boolean> => {
		if (signal?.aborted) {
			return Promise.resolve(false);
		}
		detachAbort?.();
		detachAbort = undefined;
		resolveCurrent?.(false);
		resolveCurrent = undefined;
		state.visible = true;
		state.loading = false;
		return new Promise<boolean>((resolve) => {
			resolveCurrent = resolve;
			if (signal) {
				const abort = (): void => {
					if (resolveCurrent === resolve) {
						finish(false);
					}
				};

				signal.addEventListener('abort', abort, { once: true });
				detachAbort = () => signal.removeEventListener('abort', abort);
			}
		});
	};

	const confirm = (options: ConfirmDialogOptions): Promise<boolean> => {
		if (options.signal?.aborted) {
			return Promise.resolve(false);
		}
		state.kind = 'confirm';
		state.title = options.title;
		state.message = options.message;
		state.confirmText = options.confirmText;
		state.cancelText = options.cancelText;
		state.destructive = Boolean(options.destructive);
		return begin(options.signal);
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
		detachAbort?.();
		detachAbort = undefined;
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
