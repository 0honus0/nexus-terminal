import { onActivated, onBeforeUnmount, onDeactivated, reactive, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { TARGET_SSH_PRIVATE_KEY_MAX_BYTES } from '@nexus-terminal/shared/targets/ssh-keys/values';
import { useAuthSession } from '@/features/auth/public';
import { TargetRequestFailure, targetErrorKey } from '@/client/targets/target-types';
import { useFeedback } from '@/shared/feedback/public';
import type { SshKeyDraft, SshKeySummary } from '../model/ssh-key-types';
import { toSshKeyChanges, toSshKeyInput } from '../model/ssh-key-mapper';
import { useSshKeys } from './useSshKeys';

export function useSshKeyManagement(visible: Ref<boolean>) {
	const { t } = useI18n();
	const keys = useSshKeys();
	const auth = useAuthSession();
	const feedback = useFeedback();
	const editing = ref<SshKeySummary | null>(null);
	const showForm = ref(false);
	const form = reactive<SshKeyDraft>({ name: '', privateKey: '', passphrase: '', clearPassphrase: false });
	const message = ref('');
	const loading = ref(false);
	const keyFileInput = ref<HTMLInputElement | null>(null);
	let active = true;
	let disposed = false;
	let generation = 0;
	let controller: AbortController | null = null;

	function clearDraft(): void {
		editing.value = null;
		showForm.value = false;
		form.name = '';
		form.privateKey = '';
		form.passphrase = '';
		form.clearPassphrase = false;
		if (keyFileInput.value) {
			keyFileInput.value.value = '';
		}
	}

	function reset(): void {
		generation += 1;
		controller?.abort();
		controller = null;
		loading.value = false;
		message.value = '';
		clearDraft();
	}

	async function execute(
		work: (signal: AbortSignal) => Promise<void>,
		operation: 'read' | 'write' = 'write',
	): Promise<void> {
		if (loading.value || !visible.value || !active || disposed) {
			return;
		}
		const current = ++generation;
		controller = new AbortController();
		const signal = controller.signal;
		loading.value = true;
		message.value = '';
		try {
			await work(signal);
		} catch (cause) {
			if (current === generation && !disposed) {
				message.value = t('sshKeys.failures.' + targetErrorKey(cause, operation));
				if (keys.needsRefresh.value) {
					clearDraft();
				}
			}
		} finally {
			if (current === generation && !disposed) {
				loading.value = false;
				controller = null;
			}
		}
	}

	function refresh(): Promise<void> {
		if (loading.value) {
			return Promise.resolve();
		}
		clearDraft();
		return execute(async () => {
			await keys.load(true);
		}, 'read');
	}

	function edit(key: SshKeySummary | null = null): void {
		if (loading.value || keys.busy.value || keys.needsRefresh.value || !visible.value || disposed || !active) {
			return;
		}
		clearDraft();
		editing.value = key;
		form.name = key?.name ?? '';
		showForm.value = true;
	}

	function submit(): Promise<void> {
		const snapshot = editing.value;
		return execute(async (signal) => {
			if (snapshot) {
				await keys.update(snapshot, toSshKeyChanges(form), signal);
			} else {
				await keys.create(toSshKeyInput(form), signal);
			}
			if (!signal.aborted && active && !disposed) {
				clearDraft();
			}
		});
	}

	function remove(key: SshKeySummary): Promise<void> {
		return execute(async (signal) => {
			const confirmed = await feedback.confirm({
				signal,
				message: t('sshKeys.modal.confirmDelete', { name: key.name }),
				destructive: true,
			});
			if (!confirmed || signal.aborted || disposed || !active) {
				return;
			}
			await keys.remove(key.id, signal);
		});
	}

	function chooseKeyFile(): void {
		if (!loading.value && !keys.busy.value && !keys.needsRefresh.value) {
			keyFileInput.value?.click();
		}
	}

	function loadKeyFile(event: Event): Promise<void> {
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) {
			return Promise.resolve();
		}
		const file = input.files?.[0];
		input.value = '';
		if (!file || !showForm.value) {
			return Promise.resolve();
		}
		return execute(async (signal) => {
			if (file.size > TARGET_SSH_PRIVATE_KEY_MAX_BYTES) {
				throw new TargetRequestFailure('invalid_input', 'not_dispatched');
			}
			let privateKey: string;
			try {
				privateKey = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
					await file.arrayBuffer(),
				);
			} catch (cause) {
				throw new TargetRequestFailure('invalid_input', 'not_dispatched', { cause });
			}
			if (!signal.aborted && visible.value && active && !disposed) {
				form.privateKey = privateKey;
				if (!form.name.trim()) {
					form.name = file.name;
				}
			}
		});
	}

	watch(
		() => form.passphrase,
		(value) => {
			if (value) {
				form.clearPassphrase = false;
			}
		},
	);
	watch(
		() => form.clearPassphrase,
		(value) => {
			if (value) {
				form.passphrase = '';
			}
		},
	);
	watch(
		visible,
		(value) => {
			reset();
			if (value) {
				void refresh();
			}
		},
		{ immediate: true, flush: 'sync' },
	);
	watch(
		() => (auth.isAuthenticated.value ? auth.user.value?.id : null),
		() => {
			visible.value = false;
			reset();
		},
		{ flush: 'sync' },
	);
	onActivated(() => {
		active = true;
		if (visible.value) {
			void refresh();
		}
	});
	onDeactivated(() => {
		active = false;
		visible.value = false;
		reset();
	});
	onBeforeUnmount(() => {
		disposed = true;
		reset();
	});
	return {
		keys,
		editing,
		showForm,
		form,
		message,
		loading,
		keyFileInput,
		reset,
		edit,
		submit,
		remove,
		refresh,
		chooseKeyFile,
		loadKeyFile,
	};
}
