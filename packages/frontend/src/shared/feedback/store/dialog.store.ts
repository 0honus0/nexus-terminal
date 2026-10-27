import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { AlertDialogOptions, ConfirmDialogOptions, DialogDetail, DialogTone } from '../model';

type DialogKind = 'confirm' | 'alert';

interface DialogState {
	visible: boolean;
	kind: DialogKind;
	title?: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	destructive: boolean;
	tone?: DialogTone;
	icon?: string;
	details: DialogDetail[];
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
		tone: undefined,
		icon: undefined,
		details: [],
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
		state.tone = options.tone;
		state.icon = options.icon;
		state.details = options.details?.map(({ label, value, mono, tone }) => ({ label, value, mono, tone })) ?? [];
		return begin(options.signal);
	};

	const alert = async (options: AlertDialogOptions): Promise<void> => {
		state.kind = 'alert';
		state.title = options.title;
		state.message = options.message;
		state.confirmText = options.okText;
		state.cancelText = undefined;
		state.destructive = false;
		state.tone = undefined;
		state.icon = undefined;
		state.details = [];
		await begin();
	};

	const finish = (result: boolean): void => {
		detachAbort?.();
		detachAbort = undefined;
		resolveCurrent?.(result);
		resolveCurrent = undefined;
		state.visible = false;
		state.loading = false;
		state.tone = undefined;
		state.icon = undefined;
		state.details = [];
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
