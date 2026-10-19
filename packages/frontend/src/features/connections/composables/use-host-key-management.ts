import { computed, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthSession } from '@/features/auth/public';
import { useFeedback } from '@/shared/feedback/public';
import { InvalidTargetPayload } from '@nexus-terminal/shared/targets/http';
import { targetErrorKey, TargetRequestFailure } from '@/client/targets/target-types';
import { hostKeysApi } from '../api/host-keys-api';
import { toHostKeyConfirmation } from '../model/host-key-mapper';
import type { HostKeyDraft, HostKeySummary } from '../model/host-key-types';

export function useHostKeyManagement(props: Readonly<{ visible: boolean }>, close: () => void) {
	const { t } = useI18n();
	const auth = useAuthSession();
	const feedback = useFeedback();
	const items = ref<HostKeySummary[]>([]);
	const draft = reactive<HostKeyDraft>({ host: '', port: '22', fingerprint: '' });
	const loading = ref(false);
	const needsRefresh = ref(true);
	const message = ref('');
	const canWrite = computed(() => props.visible && !loading.value && !needsRefresh.value);
	let generation = 0;
	let disposed = false;
	let controller: AbortController | null = null;

	function reset(): void {
		generation += 1;
		controller?.abort();
		controller = null;
		items.value = [];
		draft.host = '';
		draft.port = '22';
		draft.fingerprint = '';
		loading.value = false;
		needsRefresh.value = true;
		message.value = '';
	}

	async function execute(work: (signal: AbortSignal) => Promise<void>, operation: 'read' | 'write'): Promise<void> {
		if (disposed || !props.visible || loading.value || (operation === 'write' && needsRefresh.value)) {
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
			if (current === generation && !signal.aborted) {
				message.value = t('hostKeys.failures.' + targetErrorKey(cause, operation));
				const notDispatched =
					cause instanceof InvalidTargetPayload ||
					(cause instanceof TargetRequestFailure && cause.outcome === 'not_dispatched');
				// A dispatched refusal may reflect a changed pin; local input errors do not.
				if (!notDispatched) {
					needsRefresh.value = true;
				}
			}
		} finally {
			if (current === generation) {
				loading.value = false;
				controller = null;
			}
		}
	}

	function refresh(): Promise<void> {
		return execute(async (signal) => {
			needsRefresh.value = true;
			const incoming = await hostKeysApi.list(signal);
			if (signal.aborted) {
				return;
			}
			items.value = incoming;
			needsRefresh.value = false;
		}, 'read');
	}

	function confirm(): Promise<void> {
		return execute(async (signal) => {
			const command = toHostKeyConfirmation(draft);
			const accepted = await feedback.confirm({
				signal,
				message: t('hostKeys.confirmPrompt', {
					host: command.host,
					port: command.port,
					fingerprint: command.fingerprint,
				}),
				destructive: true,
			});
			if (!accepted || signal.aborted) {
				return;
			}
			const result = await hostKeysApi.confirm(command, signal);
			if (signal.aborted) {
				return;
			}
			items.value = items.value
				.filter((item) => item.host !== result.host || item.port !== result.port)
				.concat(result);
			draft.host = '';
			draft.fingerprint = '';
			message.value = t('hostKeys.saved');
		}, 'write');
	}

	function remove(item: HostKeySummary): Promise<void> {
		return execute(async (signal) => {
			const host = item.host;
			const port = item.port;
			const accepted = await feedback.confirm({
				signal,
				message: t('hostKeys.removePrompt', { host, port }),
				destructive: true,
			});
			if (!accepted || signal.aborted) {
				return;
			}
			await hostKeysApi.remove(item, signal);
			if (!signal.aborted) {
				items.value = items.value.filter((row) => row.host !== host || row.port !== port);
				message.value = t('hostKeys.removed');
			}
		}, 'write');
	}

	watch(
		() => props.visible,
		(visible) => {
			reset();
			if (visible) {
				void refresh();
			}
		},
		{ immediate: true, flush: 'sync' },
	);
	watch(
		() => (auth.isAuthenticated.value ? auth.user.value?.id : null),
		() => {
			reset();
			close();
		},
		{ flush: 'sync' },
	);
	onDeactivated(() => {
		reset();
		close();
	});
	onBeforeUnmount(() => {
		disposed = true;
		reset();
	});
	return { items, draft, loading, needsRefresh, message, canWrite, refresh, confirm, remove };
}
