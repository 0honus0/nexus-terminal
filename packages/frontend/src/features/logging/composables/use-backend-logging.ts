import { useFeedback } from '@/shared/feedback/public';
import { isNetworkFailure } from '@/client/http/network-failure';
import { onMounted, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { type BackendLogLevel } from '@nexus-terminal/shared/operations/logging/values';
import { useAuthenticatedViewScope } from '@/shared/session/public';
import { OperationsRequestFailure } from '@/client/operations/operations-request';
import { loggingApi } from '../api/logging-api';
import type { BackendLogging } from '../model/logging-types';

export function useBackendLogging() {
	const { t } = useI18n();
	const feedback = useFeedback();
	const snapshot = shallowRef<BackendLogging | null>(null);
	const level = ref<BackendLogLevel>('info');
	const busy = ref(false);
	const needsRefresh = ref(true);
	const message = ref('');
	const view = useAuthenticatedViewScope({
		onRevoke: () => {
			snapshot.value = null;
			busy.value = false;
			needsRefresh.value = true;
			message.value = '';
		},
	});

	async function execute(write = false): Promise<void> {
		if (busy.value || (write && (!snapshot.value || needsRefresh.value))) return;
		const signal = view.capture();
		if (signal.aborted) return;
		const original = snapshot.value;
		const intended = level.value;
		busy.value = true;
		message.value = '';
		try {
			const value =
				write && original
					? await loggingApi.update(original.version, intended, signal)
					: await loggingApi.get(signal);
			if (!view.isCurrent(signal)) return;
			snapshot.value = value;
			level.value = value.level;
			needsRefresh.value = false;
			if (write) message.value = t('settings.preferences.saved');
		} catch (cause) {
			if (!view.isCurrent(signal)) return;
			needsRefresh.value = true;
			const code = cause instanceof OperationsRequestFailure ? cause.code : 'internal_failure';
			const unknown = !(cause instanceof OperationsRequestFailure) || cause.outcome === 'unknown';
			message.value = t(
				unknown
					? 'common.personalDataUnknown'
					: code === 'version_conflict'
						? 'common.personalDataConflict'
						: 'common.personalDataFailure',
			);
			if (!isNetworkFailure(cause)) feedback.notifyError(message.value);
		} finally {
			if (view.isCurrent(signal)) busy.value = false;
		}
	}

	onMounted(() => execute());

	return { snapshot, level, busy, needsRefresh, message, execute };
}
