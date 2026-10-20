<script setup lang="ts">
	import { onActivated, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import { getModelRegistryStatus, refreshModelRegistry } from '../api/registry-api';
	import { AgentManagementFailure } from '../model/management-failure';
	import type { ModelRegistryStatus } from '../model/registry-types';
	import { formatAgentDate } from '../locale-format';

	const { t, locale } = useI18n();
	const status = ref<ModelRegistryStatus | null>(null);
	const busy = ref(false);
	const error = ref('');
	const refreshBlocked = ref(false);
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
		class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
		:aria-label="t('agent.settings.providers.registryTitle')"
	>
		<div class="agent-settings-head border-b border-border bg-header/50 px-4 py-3 sm:px-5 sm:py-3.5">
			<h3 class="text-sm font-semibold text-foreground">{{ t('agent.settings.providers.registryTitle') }}</h3>
		</div>
		<div class="space-y-3 p-4 sm:p-5">
			<div v-if="status" class="flex flex-wrap gap-2 text-sm text-text-secondary">
				<span>{{ status.entryCount }} {{ t('agent.settings.providers.registryModels') }}</span>
				<span v-if="status.generatedAt !== null">{{
					formatAgentDate(locale, new Date(status.generatedAt))
				}}</span>
				<span v-if="status.lastErrorCode" class="text-error">{{ status.lastErrorCode }}</span>
			</div>
			<p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
			<div class="flex gap-2">
				<UiButton v-if="error || refreshBlocked" type="button" :disabled="busy" @click="load(false)">{{
					t('agent.settings.providers.registryReadStatus')
				}}</UiButton>
				<UiButton type="button" :disabled="busy || refreshBlocked" @click="load(true)">{{
					t('agent.settings.providers.registryRefresh')
				}}</UiButton>
			</div>
		</div>
	</section>
</template>
