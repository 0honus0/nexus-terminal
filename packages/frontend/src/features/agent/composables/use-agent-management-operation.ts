import { ref } from 'vue';
import { useAuthenticatedViewScope, type ViewRevocation } from '@/shared/session/use-authenticated-view-scope';
import { AgentManagementFailure } from '../model/management-failure';

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
export function useAgentManagementOperation(onRevoke?: (reason: ViewRevocation) => void, available?: () => boolean) {
	const busy = ref(false);
	const refreshRequired = ref(true);
	const notice = ref('');
	let generation = 0;
	const scope = useAuthenticatedViewScope({
		available,

		onRevoke(reason) {
			generation += 1;
			busy.value = false;
			refreshRequired.value = true;
			notice.value = '';
			onRevoke?.(reason);
		},
	});

	async function execute<T>(
		action: (signal: AbortSignal) => Promise<T>,
		accept: (result: T) => void,
		options: { write: boolean; refreshAfterSuccess?: boolean; onFailure?: (cause: unknown) => void },
	): Promise<void> {
		if (busy.value || (options.write && refreshRequired.value)) {
			return;
		}
		const signal = scope.capture();
		if (!scope.isCurrent(signal)) {
			return;
		}
		const current = ++generation;
		busy.value = true;
		notice.value = '';
		try {
			const result = await action(signal);
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
			const failure = cause instanceof AgentManagementFailure ? cause : null;
			notice.value = failureNotice(cause, options.write);
			if (options.write && (!failure || failure.outcome !== 'not_dispatched')) {
				refreshRequired.value = true;
			}
			options.onFailure?.(cause);
		} finally {
			if (generation === current && scope.isCurrent(signal)) {
				busy.value = false;
			}
		}
	}

	return { busy, refreshRequired, notice, execute };
}
