import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '@/shared/feedback/public';
import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
import { closeNativeResources } from '../api/native-resource-api';
import { AgentManagementFailure } from '../model/management-failure';
import type { NativeThreadScope } from '../model/native-thread-types';
import type { NativeResourceCloseTarget } from '../model/native-resource-types';

export function useAgentResourceControl(available: () => boolean) {
	const busy = ref(false);
	const uncertain = ref(false);
	const { t } = useI18n();
	const feedback = useFeedback();
	const view = useAuthenticatedViewScope({ available });

	async function closeTargets(
		targets: Array<{ scope: NativeThreadScope; target: NativeResourceCloseTarget }>,
		requestSignal?: AbortSignal,
	): Promise<boolean> {
		if (busy.value) return false;
		const viewSignal = view.capture();
		const signal = requestSignal ? AbortSignal.any([viewSignal, requestSignal]) : viewSignal;

		const isCurrent = () => view.isCurrent(viewSignal) && !signal.aborted;

		if (!isCurrent()) return false;
		busy.value = true;
		uncertain.value = false;
		try {
			const attempts = await Promise.allSettled(
				targets.map(({ scope, target }) => closeNativeResources(scope, target, false, signal)),
			);
			const failures = attempts.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1) throw new AggregateError(failures, 'Resource close attempts failed');
			const results = attempts.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
			if (!isCurrent()) return false;
			const pending = targets.filter((_, index) => results[index]?.status === 'confirmation_required');
			if (pending.length) {
				const accepted = await feedback.confirm({
					title: t('agent.resources.closeTitle'),
					message: t('agent.resources.closeMessage', {
						tasks: results.reduce((n, value) => n + value.activeRuns, 0),
						operations: results.reduce((n, value) => n + value.activeOperations, 0),
						jobs: results.reduce((n, value) => n + value.backgroundJobs, 0),
					}),
					confirmText: t('agent.resources.stopAndClose'),
					cancelText: t('common.cancel'),
					destructive: true,
					signal,
				});
				if (!accepted || !isCurrent()) return false;
				const completed = await Promise.allSettled(
					targets.map(({ scope, target }) => closeNativeResources(scope, target, true, signal)),
				);
				const failures = completed.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
				if (failures.length === 1) throw failures[0];
				if (failures.length > 1) throw new AggregateError(failures, 'Resource close attempts failed');
				if (completed.some((result) => result.status === 'fulfilled' && result.value.status !== 'closed'))
					throw new AgentManagementFailure('version_conflict', 'confirmed');
			}
			return isCurrent();
		} catch (error) {
			if (isCurrent()) {
				uncertain.value = !(error instanceof AgentManagementFailure) || error.outcome === 'unknown';
				feedback.notifyError(
					t(uncertain.value ? 'agent.settings.appManagement.unknown' : 'agent.settings.appManagement.failed'),
				);
			}
			return false;
		} finally {
			busy.value = false;
		}
	}

	function close(
		scope: NativeThreadScope,
		target: NativeResourceCloseTarget,
		signal?: AbortSignal,
	): Promise<boolean> {
		return closeTargets([{ scope: { appId: scope.appId, appVersion: scope.appVersion }, target }], signal);
	}

	function closeApps(scopes: NativeThreadScope[]): Promise<boolean> {
		return closeTargets(
			scopes.map((scope) => ({
				scope: { appId: scope.appId, appVersion: scope.appVersion },
				target: { kind: 'app' },
			})),
		);
	}

	return { busy, uncertain, close, closeApps };
}
