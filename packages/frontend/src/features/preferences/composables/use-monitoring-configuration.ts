import { useI18n } from 'vue-i18n';
import { useFeedbackMessage } from '@/shared/feedback/public';
import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, ref, shallowReadonly } from 'vue';
import { registerAuthenticatedSessionOwner } from '@/shared/session/public';
import {
	SETTINGS_MONITORING_MIN_SECONDS,
	SETTINGS_MONITORING_MAX_SECONDS,
} from '@nexus-terminal/shared/preferences/configuration/values';
import { configurationApi } from '../api/configuration-api';
import {
	ConfigurationFailure,
	type CoreConfiguration,
	type MonitoringConfigurationController,
	type MonitoringDraft,
	type MonitoringFeedback,
} from '../model/configuration-types';

let nextOwnerId = 0;

function validInterval(value: number): boolean {
	return (
		Number.isSafeInteger(value) &&
		value >= SETTINGS_MONITORING_MIN_SECONDS &&
		value <= SETTINGS_MONITORING_MAX_SECONDS
	);
}

export function createMonitoringConfiguration(onFailure?: (cause: unknown) => void): MonitoringConfigurationController {
	const snapshot = ref<CoreConfiguration | null>(null);
	const draft = ref<MonitoringDraft | null>(null);
	const loading = ref(false);
	const needsRefresh = ref(true);
	const feedback = ref<MonitoringFeedback | null>(null);
	let active = true;
	let started = false;
	let disposed = false;
	let request: AbortController | null = null;
	const canSave = computed(() => {
		const original = snapshot.value,
			input = draft.value;
		return (
			active &&
			!disposed &&
			!loading.value &&
			!needsRefresh.value &&
			original !== null &&
			input !== null &&
			validInterval(input.statusIntervalSeconds) &&
			validInterval(input.hostIntervalSeconds) &&
			(input.statusIntervalSeconds !== original.statusIntervalSeconds ||
				input.hostIntervalSeconds !== original.hostIntervalSeconds)
		);
	});

	function reset(): void {
		request?.abort();
		request = null;
		snapshot.value = null;
		draft.value = null;
		loading.value = false;
		needsRefresh.value = true;
		feedback.value = null;
	}

	function publish(value: CoreConfiguration): void {
		snapshot.value = value;
		draft.value = {
			statusIntervalSeconds: value.statusIntervalSeconds,
			hostIntervalSeconds: value.hostIntervalSeconds,
		};
		needsRefresh.value = false;
	}

	async function execute(work?: (signal: AbortSignal) => Promise<CoreConfiguration>): Promise<void> {
		if (!active || disposed || request) {
			return;
		}
		started = true;
		const current = new AbortController();
		request = current;
		loading.value = true;
		feedback.value = null;
		try {
			const value = work ? await work(current.signal) : await configurationApi.get(current.signal);
			if (request !== current) {
				return;
			}
			publish(value);
			if (work) {
				feedback.value = 'saved';
			}
		} catch (cause) {
			if (request !== current) {
				return;
			}
			onFailure?.(cause);
			const failure = cause instanceof ConfigurationFailure ? cause : null;
			feedback.value =
				!failure || failure.outcome === 'unknown'
					? 'unknown'
					: failure.code === 'version_conflict'
						? 'conflict'
						: failure.code;
			if (!work || !failure || failure.outcome === 'unknown' || failure.code !== 'invalid_input') {
				needsRefresh.value = true;
			}
		} finally {
			if (request === current) {
				request = null;
				loading.value = false;
			}
		}
	}

	function refresh(): Promise<void> {
		return execute();
	}

	function save(): Promise<void> {
		const original = snapshot.value,
			input = draft.value;
		if (!canSave.value || !original || !input) {
			return Promise.resolve();
		}
		const command: MonitoringDraft = {
			statusIntervalSeconds: input.statusIntervalSeconds,
			hostIntervalSeconds: input.hostIntervalSeconds,
		};
		return execute((signal) => configurationApi.saveMonitoring(original, command, signal));
	}

	const unregister = registerAuthenticatedSessionOwner(`monitoring-configuration-${++nextOwnerId}`, (event) => {
		reset();
		if (active && started && (event.type === 'attach' || event.type === 'user-changed')) {
			void refresh();
		}
	});

	function activate(): void {
		if (disposed) {
			return;
		}
		active = true;
		if (needsRefresh.value) {
			void refresh();
		}
	}

	function deactivate(): void {
		active = false;
		reset();
	}

	function dispose(): void {
		disposed = true;
		deactivate();
		unregister();
	}

	return {
		snapshot: shallowReadonly(snapshot),
		draft,
		loading: shallowReadonly(loading),
		needsRefresh: shallowReadonly(needsRefresh),
		feedback: shallowReadonly(feedback),
		canSave,
		refresh,
		save,
		activate,
		deactivate,
		dispose,
	};
}

export function useMonitoringConfiguration(): MonitoringConfigurationController {
	let failureCause: unknown;
	const controller = createMonitoringConfiguration((cause) => {
		failureCause = cause;
	});
	const { t } = useI18n();
	useFeedbackMessage(
		() => (controller.feedback.value ? t('settings.monitoring.feedback.' + controller.feedback.value) : ''),
		() => (controller.feedback.value === 'saved' ? 'success' : 'error'),
		() => failureCause,
	);
	onMounted(controller.activate);
	onActivated(controller.activate);
	onDeactivated(controller.deactivate);
	onScopeDispose(controller.dispose);
	return controller;
}
