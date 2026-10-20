<script setup lang="ts">
	import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiSelect, UiButton } from '@/foundation/ui';
	import { useAuthSession } from '@/features/auth/public';
	import { targetErrorKey } from '@/client/targets/target-types';
	import { useSshKeys } from '../composables/useSshKeys';
	import SshKeyManagementModal from './SshKeyManagementModal.vue';
	const { t } = useI18n();
	const model = defineModel<number | null>({ default: null });
	const keys = useSshKeys();
	const auth = useAuthSession();
	const manage = ref(false);
	const loading = ref(false);
	const loadError = ref('');
	let generation = 0;
	let active = true;
	let disposed = false;

	function reset(): void {
		generation += 1;
		manage.value = false;
		loading.value = false;
		loadError.value = '';
	}

	async function refresh(): Promise<void> {
		if (loading.value || !active || disposed) {
			return;
		}
		const current = ++generation;
		loading.value = true;
		loadError.value = '';
		try {
			await keys.load(true);
		} catch (cause) {
			if (current === generation && !disposed) {
				loadError.value = t('sshKeys.failures.' + targetErrorKey(cause, 'read'));
			}
		} finally {
			if (current === generation && !disposed) {
				loading.value = false;
			}
		}
	}

	watch([keys.keys, keys.loaded, keys.needsRefresh, keys.busy], ([available, loaded, needsRefresh, busy]) => {
		if (
			active &&
			!disposed &&
			auth.isAuthenticated.value &&
			loaded &&
			!needsRefresh &&
			!busy &&
			model.value !== null &&
			!available.some((key) => key.id === model.value)
		) {
			model.value = null;
		}
	});
	watch(() => (auth.isAuthenticated.value ? auth.user.value?.id : null), reset, { flush: 'sync' });
	onMounted(refresh);
	onActivated(() => {
		active = true;
		if (keys.needsRefresh.value) {
			void refresh();
		}
	});
	onDeactivated(() => {
		active = false;
		reset();
	});
	onBeforeUnmount(() => {
		disposed = true;
		reset();
	});
</script>
<template>
	<div class="space-y-2">
		<div class="flex items-center space-x-3">
			<UiSelect
				id="ssh-key-select"
				v-model="model"
				class="min-w-0 flex-1"
				:disabled="loading || keys.busy.value || keys.needsRefresh.value"
			>
				<option :value="null">{{ t('sshKeys.selector.selectPlaceholder') }}</option>
				<option v-for="key in keys.keys.value" :key="key.id" :value="key.id">{{ key.name }}</option>
			</UiSelect>
			<button
				type="button"
				class="shrink-0 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-text-secondary hover:bg-border disabled:opacity-50"
				:disabled="loading || keys.busy.value"
				:title="t('sshKeys.selector.manageKeysTitle')"
				@click="manage = true"
			>
				<i class="fas fa-cog" aria-hidden="true" />
			</button>
			<UiButton
				v-if="!loading && (loadError || keys.needsRefresh.value)"
				:disabled="loading || keys.busy.value"
				@click="refresh"
				>{{ t('sshKeys.refresh') }}</UiButton
			>
		</div>
		<div v-if="loading" class="text-xs text-text-secondary">{{ t('sshKeys.selector.loadingKeys') }}</div>
		<div v-else-if="loadError" role="alert" class="break-words text-xs text-error">{{ loadError }}</div>
		<SshKeyManagementModal v-model="manage" />
	</div>
</template>
