import { useI18n } from 'vue-i18n';
import { useFeedbackMessage } from '@/shared/feedback/public';
import { ref } from 'vue';
import { useAuthenticatedViewScope, type ViewRevocation } from '@/shared/session/use-authenticated-view-scope';
import { AgentManagementFailure } from '../model/management-failure';
import { isNetworkFailure } from '@/client/http/network-failure';

function failureNotice(cause: unknown, writing: boolean): string {
	if (cause instanceof AgentManagementFailure) {
		if (cause.code === 'version_conflict') {
			return 'conflict';
		}
		if (cause.code === 'invalid_input') {
			return 'invalid';
		}
		if (cause.outcome !== 'unknown') {
			return 'failed';
		}
	}
	return writing ? 'unknown' : 'failed';
}

/** Owns one independently versioned editor's request, failure fence and view lifetime. */
export function useAgentManagementOperation(
	onRevoke?: (reason: ViewRevocation) => void,
	available?: () => boolean,
	options: { retainOnView?: boolean } = {},
) {
	const busy = ref(false);
	const refreshRequired = ref(true);
	const notice = ref('');
	let failureCause: unknown;
	const { t } = useI18n();
	useFeedbackMessage(
		() =>
			notice.value === 'deleteThreadActive'
				? t('agent.operations.deleteThreadActiveHint')
				: notice.value
					? t('agent.settings.appManagement.' + notice.value)
					: '',
		() => (notice.value === 'saved' ? 'success' : 'error'),
		() => failureCause,
	);
	let generation = 0;
	let backgroundRequest: AbortController | null = null;
	const scope = useAuthenticatedViewScope({
		available,
		retainOnView: options.retainOnView,

		onRevoke(reason) {
			generation += 1;
			backgroundRequest?.abort();
			backgroundRequest = null;
			busy.value = false;
			refreshRequired.value = true;
			notice.value = '';
			failureCause = undefined;
			onRevoke?.(reason);
		},
	});

	async function execute<T>(
		action: (signal: AbortSignal) => Promise<T>,
		accept: (result: T) => void,
		options: { refreshAfterSuccess?: boolean; onFailure?: (cause: unknown) => void } & (
			{ write: true; background?: never } | { write: false; background?: boolean }
		),
	): Promise<void> {
		if (busy.value || (options.background && backgroundRequest) || (options.write && refreshRequired.value)) {
			return;
		}
		const signal = scope.capture();
		if (!scope.isCurrent(signal)) {
			return;
		}
		// Interactive work supersedes background reads; an aborted read cannot publish late state.
		backgroundRequest?.abort();
		backgroundRequest = options.background ? new AbortController() : null;
		const requestSignal = backgroundRequest ? AbortSignal.any([signal, backgroundRequest.signal]) : signal;
		const current = ++generation;
		busy.value = !options.background;
		notice.value = '';
		failureCause = undefined;
		try {
			const result = await action(requestSignal);
			if (generation !== current || !scope.isCurrent(signal)) {
				return;
			}
			accept(result);
			refreshRequired.value = options.refreshAfterSuccess ?? false;
			if (options.write) {
				notice.value = 'saved';
			}
		} catch (cause) {
			if (generation !== current || !scope.isCurrent(signal)) {
				return;
			}
			failureCause = cause;
			const failure = cause instanceof AgentManagementFailure ? cause : null;
			notice.value = !options.write && isNetworkFailure(cause) ? '' : failureNotice(cause, options.write);
			if (options.write && (!failure || failure.outcome !== 'not_dispatched')) {
				refreshRequired.value = true;
			}
			options.onFailure?.(cause);
		} finally {
			if (generation === current && scope.isCurrent(signal)) {
				busy.value = false;
				backgroundRequest = null;
			}
		}
	}

	return { busy, refreshRequired, notice, execute };
}
