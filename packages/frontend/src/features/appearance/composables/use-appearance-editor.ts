import { ref, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '@/shared/feedback/public';
import { useAuthenticatedViewScope } from '@/shared/session/public';
import { appearanceFailureKey } from '../model/appearance-failure';
import { isNetworkFailure } from '@/client/http/network-failure';

/** Owns feedback and temporary editor intent; accepted work remains owned by the store. */
export function useAppearanceEditor(options: { available?: () => boolean } = {}): {
	run(work: (permission: AbortSignal) => Promise<unknown>, options?: { notify?: boolean }): Promise<boolean>;
	capture(): AbortSignal;
	isCurrent(signal: AbortSignal): boolean;
	busy: Ref<boolean>;
} {
	const busy = ref(false);
	const scope = useAuthenticatedViewScope({
		available: options.available,

		onRevoke: () => {
			busy.value = false;
		},
	});
	const { t } = useI18n();
	const feedback = useFeedback();

	async function run(
		work: (permission: AbortSignal) => Promise<unknown>,
		options: { notify?: boolean } = {},
	): Promise<boolean> {
		if (busy.value) {
			return false;
		}
		const signal = scope.capture();
		if (signal.aborted) {
			return false;
		}
		busy.value = true;
		try {
			await work(signal);
			if (scope.isCurrent(signal)) {
				if (options.notify !== false) {
					feedback.notifySuccess(t('common.saved'));
				}
				return true;
			}
			return false;
		} catch (cause) {
			if (scope.isCurrent(signal) && !isNetworkFailure(cause)) {
				feedback.notifyError(t(appearanceFailureKey(cause)));
			}
			return false;
		} finally {
			if (scope.isCurrent(signal)) {
				busy.value = false;
			}
		}
	}

	return { run, capture: scope.capture, isCurrent: scope.isCurrent, busy };
}
