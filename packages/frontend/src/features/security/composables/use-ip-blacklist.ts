import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { authErrorKey, useAuthSession } from '@/features/auth/public';
import { useFeedback } from '@/shared/feedback/public';
import { ipBlacklistApi } from '../api/ip-blacklist-api';
import type { BlockedAddress, IpBlacklistController } from '../model/security-types';

export function useIpBlacklist(): IpBlacklistController {
	const { t } = useI18n();
	const auth = useAuthSession();
	const feedback = useFeedback();
	const entries = ref<BlockedAddress[]>([]);
	const total = ref(0);
	const offset = ref(0);
	const loading = ref(false);
	const needsRefresh = ref(true);
	const message = ref('');
	const pageSize = 50;
	let generation = 0;
	let active = true;
	let disposed = false;
	let controller: AbortController | null = null;

	function reset(): void {
		generation += 1;
		controller?.abort();
		controller = null;
		entries.value = [];
		total.value = 0;
		offset.value = 0;
		loading.value = false;
		needsRefresh.value = true;
		message.value = '';
	}

	async function execute(nextOffset: number, ip?: string): Promise<void> {
		if (loading.value || disposed || !active || (ip !== undefined && needsRefresh.value)) {
			return;
		}
		const current = ++generation;
		controller = new AbortController();
		const signal = controller.signal;
		loading.value = true;
		message.value = '';
		let committed = false;
		try {
			if (ip !== undefined) {
				const confirmed = await feedback.confirm({
					message: t('settings.ipBlacklist.confirmRemoveIp', { ip }),
					destructive: true,
				});
				if (!confirmed || current !== generation || signal.aborted) {
					return;
				}
				await ipBlacklistApi.remove(ip, signal);
				committed = true;
			}
			if (current !== generation || signal.aborted) {
				return;
			}
			const result = await ipBlacklistApi.list(pageSize, nextOffset, signal);
			if (current !== generation || signal.aborted || disposed) {
				return;
			}
			entries.value = result.entries;
			total.value = result.total;
			offset.value = nextOffset;
			needsRefresh.value = false;
		} catch (cause) {
			if (current === generation && !disposed) {
				needsRefresh.value = true;
				message.value = t(committed ? 'settings.configuration.refreshAfterChange' : authErrorKey(cause));
			}
		} finally {
			if (current === generation && !disposed) {
				loading.value = false;
				controller = null;
			}
		}
	}

	function refresh(): Promise<void> {
		return execute(offset.value);
	}

	function previous(): Promise<void> {
		return execute(Math.max(0, offset.value - pageSize));
	}

	function next(): Promise<void> {
		return execute(offset.value + pageSize);
	}

	function remove(ip: string): Promise<void> {
		return execute(offset.value, ip);
	}

	watch(() => (auth.isAuthenticated.value ? auth.user.value?.id : null), reset);
	onMounted(refresh);
	onActivated(() => {
		active = true;
		if (needsRefresh.value) {
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
	return { entries, total, offset, pageSize, loading, needsRefresh, message, refresh, previous, next, remove };
}
