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
	): Promise<boolean> {
		if (busy.value) return false;
		const signal = view.capture();
		if (!view.isCurrent(signal)) return false;
		busy.value = true;
		uncertain.value = false;
		try {
			const results = await Promise.all(
				targets.map(({ scope, target }) => closeNativeResources(scope, target, false, signal)),
			);
			if (!view.isCurrent(signal)) return false;
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
				if (!accepted || !view.isCurrent(signal)) return false;
				const completed = await Promise.allSettled(
					targets.map(({ scope, target }) => closeNativeResources(scope, target, true, signal)),
				);
				const failed = completed.find((result) => result.status === 'rejected');
				if (failed?.status === 'rejected') throw failed.reason;
				if (completed.some((result) => result.status === 'fulfilled' && result.value.status !== 'closed'))
					throw new AgentManagementFailure('version_conflict', 'confirmed');
			}
			return view.isCurrent(signal);
		} catch (error) {
			if (view.isCurrent(signal)) {
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

	function close(scope: NativeThreadScope, target: NativeResourceCloseTarget): Promise<boolean> {
		return closeTargets([{ scope: { appId: scope.appId, appVersion: scope.appVersion }, target }]);
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
