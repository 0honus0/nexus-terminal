<script setup lang="ts">
	import { useFeedbackMessage } from '@/shared/feedback/public';
	import { computed, onActivated, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import { getModelRegistryStatus, refreshModelRegistry } from '../api/registry-api';
	import { AgentManagementFailure } from '../model/management-failure';
	import type { ModelRegistryStatus } from '../model/registry-types';
	import { formatAgentDate } from '../locale-format';

	const { t, te, locale } = useI18n();
	const status = ref<ModelRegistryStatus | null>(null);
	const busy = ref(false);
	const error = ref('');
	let failureCause: unknown;
	useFeedbackMessage(
		() => error.value,
		undefined,
		() => failureCause,
	);
	const refreshBlocked = ref(false);
	const statusError = computed(() => {
		const code = status.value?.lastErrorCode;
		if (!code) return '';
		const key = 'agent.settings.providers.registryErrors.' + code;
		return te(key) ? t(key) : t('agent.settings.providers.registryErrorFallback');
	});
	useFeedbackMessage(() => statusError.value);
	let generation = 0;
	const scope = useAuthenticatedViewScope({
		onRevoke() {
			generation += 1;
			status.value = null;
			busy.value = false;
			error.value = '';
		},
	});

	async function load(refresh: boolean): Promise<void> {
		if (busy.value || (refresh && refreshBlocked.value)) {
			return;
		}
		const signal = scope.capture();
		if (!scope.isCurrent(signal)) {
			return;
		}
		const current = ++generation;
		busy.value = true;
		error.value = '';
		try {
			const result = refresh ? await refreshModelRegistry(signal) : await getModelRegistryStatus(signal);
			if (current !== generation || !scope.isCurrent(signal)) {
				return;
			}
			status.value = result;
			refreshBlocked.value = false;
		} catch (cause) {
			if (current !== generation || !scope.isCurrent(signal)) {
				return;
			}
			failureCause = cause;
			const unknown = cause instanceof AgentManagementFailure && cause.outcome === 'unknown';
			error.value = t(
				'agent.settings.providers.' + (unknown && refresh ? 'registryUnknown' : 'registryRequestFailed'),
			);
			if (refresh) {
				refreshBlocked.value = true;
			}
		} finally {
			if (current === generation && scope.isCurrent(signal)) {
				busy.value = false;
			}
		}
	}

	function loadInitialStatus(): void {
		if (status.value === null) {
			void load(false);
		}
	}

	onMounted(loadInitialStatus);
	onActivated(loadInitialStatus);
</script>

<template>
	<section
		class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-header/30 px-3.5 py-2.5 text-xs"
		:aria-label="t('agent.settings.providers.registryTitle')"
	>
		<div class="flex flex-wrap items-center gap-2 text-text-secondary">
			<span class="font-medium text-foreground">{{ t('agent.settings.providers.registryTitle') }}</span>
			<template v-if="status"
				><span>{{ status.entryCount }} {{ t('agent.settings.providers.registryModels') }}</span
				><span v-if="status.generatedAt !== null"
					>· {{ formatAgentDate(locale, new Date(status.generatedAt)) }}</span
				></template
			>
		</div>
		<div class="flex items-center gap-2">
			<UiButton
				v-if="error || refreshBlocked"
				type="button"
				appearance="soft"
				:disabled="busy"
				@click="load(false)"
				>{{ t('agent.settings.providers.registryReadStatus') }}</UiButton
			>
			<UiButton
				type="button"
				appearance="soft"
				:loading="busy"
				:disabled="busy || refreshBlocked"
				@click="load(true)"
				><i class="fa-solid fa-arrows-rotate text-[9px]" aria-hidden="true"></i
				>{{ t('agent.settings.providers.registryRefresh') }}</UiButton
			>
		</div>
	</section>
</template>
