import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TargetProxyInput } from '@nexus-terminal/shared/targets/proxies/http';
import { useAuthSession } from '@/features/auth/public';
import { targetErrorKey } from '@/client/targets/target-types';
import { useFeedback, useFeedbackMessage } from '@/shared/feedback/public';
import type { ProxySummary } from '../model/proxy-types';
import { useProxies } from './useProxies';

export function useProxyManagement() {
	const { t } = useI18n();
	const data = useProxies();
	const auth = useAuthSession();
	const feedback = useFeedback();
	const modal = ref(false);
	const editing = ref<ProxySummary | null>(null);
	const loading = ref(false);
	const message = ref('');
	let failureCause: unknown;
	const messageSuccess = ref(false);
	useFeedbackMessage(
		() => message.value,
		() => (messageSuccess.value ? 'success' : 'error'),
		() => failureCause,
	);
	let generation = 0;
	let active = true;
	let disposed = false;
	let controller: AbortController | null = null;

	function reset(): void {
		generation += 1;
		controller?.abort();
		controller = null;
		modal.value = false;
		editing.value = null;
		loading.value = false;
		message.value = '';
		failureCause = undefined;
		messageSuccess.value = false;
	}

	async function execute(
		work: (signal: AbortSignal) => Promise<void>,
		operation: 'read' | 'write' = 'write',
	): Promise<void> {
		if (loading.value || disposed || !active) {
			return;
		}
		const current = ++generation;
		controller = new AbortController();
		const signal = controller.signal;
		loading.value = true;
		message.value = '';
		failureCause = undefined;
		messageSuccess.value = false;
		try {
			await work(signal);
		} catch (cause) {
			if (current === generation && !disposed) {
				failureCause = cause;
				messageSuccess.value = false;
				message.value = t('proxies.failures.' + targetErrorKey(cause, operation));
				if (data.needsRefresh.value) {
					modal.value = false;
					editing.value = null;
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
		modal.value = false;
		editing.value = null;
		return execute(async () => {
			await data.load(true);
		}, 'read');
	}

	function open(proxy: ProxySummary | null = null): void {
		if (loading.value || data.busy.value || data.needsRefresh.value || !active || disposed) {
			return;
		}
		editing.value = proxy;
		modal.value = true;
	}

	function save(input: TargetProxyInput): Promise<void> {
		const snapshot = editing.value;
		return execute(async (signal) => {
			if (snapshot) {
				await data.update(snapshot, input, signal);
			} else {
				await data.create(input, signal);
			}
			if (!signal.aborted && active && !disposed) {
				modal.value = false;
				editing.value = null;
			}
		});
	}

	function remove(proxy: ProxySummary): Promise<void> {
		return execute(async (signal) => {
			const confirmed = await feedback.confirm({
				signal,
				message: t('proxies.prompts.confirmDelete', { name: proxy.name }),
				destructive: true,
			});
			if (!confirmed || signal.aborted || disposed || !active) {
				return;
			}
			await data.remove(proxy.id, signal);
		});
	}

	watch(() => (auth.isAuthenticated.value ? auth.user.value?.id : null), reset, { flush: 'sync' });
	onMounted(refresh);
	onActivated(() => {
		active = true;
		if (!data.loaded.value || data.needsRefresh.value) {
			void refresh();
		}
	});
	onDeactivated(() => {
		active = false;
		reset();
	});
	onBeforeUnmount(() => {
		disposed = true;
		reset();
	});
	return { data, modal, editing, loading, message, refresh, open, save, remove };
}
