import { ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '@/shared/feedback/public';
import { useAuthenticatedViewScope } from '@/shared/session/public';
import { remoteToolApi } from '../api/tool-api';
import { ToolInstallFailure, type ToolRequirement, type ToolOffer } from '../model/tool-types';

export function useRemoteTools() {
	const { t } = useI18n();
	const feedback = useFeedback();
	const offer = shallowRef<ToolOffer | null>(null);
	const busy = ref(false);
	let pending = false;
	let decide: ((value: string | undefined | null) => void) | null = null;
	const scope = useAuthenticatedViewScope();

	function approve(password?: string): void {
		decide?.(password);
	}

	function cancel(): void {
		if (!busy.value) {
			decide?.(null);
		}
	}

	async function ensure(input: ToolRequirement, external: AbortSignal): Promise<boolean> {
		if (pending) {
			return false;
		}
		const permission = scope.capture();
		const signal = AbortSignal.any([permission, external]);
		if (signal.aborted) {
			return false;
		}
		pending = true;
		try {
			const checked = await remoteToolApi.check(input, signal);
			if (signal.aborted) {
				return false;
			}
			if (!checked.missing.length) {
				return true;
			}
			if (!checked.planId) {
				throw new ToolInstallFailure('unsupported');
			}
			offer.value = checked;
			const password = await new Promise<string | undefined | null>((resolve) => {
				const abort = () => finish(null);

				const finish = (value: string | undefined | null) => {
					signal.removeEventListener('abort', abort);
					decide = null;
					resolve(value);
				};

				decide = finish;
				signal.addEventListener('abort', abort, { once: true });
				if (signal.aborted) {
					abort();
				}
			});
			if (password === null || signal.aborted) {
				return false;
			}
			busy.value = true;
			await remoteToolApi.install(checked, password, signal);
			return !signal.aborted;
		} catch (cause) {
			if (!signal.aborted) {
				feedback.notifyError(
					t('remoteTools.errors.' + (cause instanceof ToolInstallFailure ? cause.code : 'unavailable')),
				);
			}
			return false;
		} finally {
			offer.value = null;
			busy.value = false;
			pending = false;
			decide = null;
		}
	}

	return { offer, busy, ensure, approve, cancel };
}
