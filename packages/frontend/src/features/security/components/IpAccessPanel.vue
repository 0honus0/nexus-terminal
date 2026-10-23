<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiButton,
		UiEmptyState,
		UiFormField,
		UiNumberInput,
		UiSettingsGroup,
		UiSwitch,
		UiTable,
		UiTextarea,
	} from '@/foundation/ui';
	import { useSettingsReloadSource } from '@/shared/feedback/public';
	import { useSecurityConfiguration } from '../composables/use-security-configuration';
	import { useIpBlacklist } from '../composables/use-ip-blacklist';
	const { t } = useI18n();
	const {
		snapshot,
		network: policy,
		loading,
		needsRefresh,
		success,
		refresh,
		saveNetwork,
	} = useSecurityConfiguration('network');
	const {
		entries,
		total,
		offset,
		pageSize,
		loading: blacklistLoading,
		needsRefresh: blacklistNeedsRefresh,
		refresh: refreshBlacklist,
		previous,
		next,
		remove,
	} = useIpBlacklist();
	useSettingsReloadSource({
		id: 'security-ip-access',

		pending: () =>
			(!loading.value && needsRefresh.value) || (!blacklistLoading.value && blacklistNeedsRefresh.value),

		reload: async () => {
			const requests: Promise<unknown>[] = [];
			if (!loading.value && needsRefresh.value) requests.push(refresh());
			if (!blacklistLoading.value && blacklistNeedsRefresh.value) requests.push(refreshBlacklist());
			await Promise.allSettled(requests);
		},
	});
	const whitelistDirty = computed(
		() => snapshot.value !== null && policy.value.whitelist !== snapshot.value.network.whitelist,
	);
	const blacklistDirty = computed(() => {
		const original = snapshot.value?.network;
		return (
			original !== undefined &&
			(policy.value.maxLoginAttempts !== original.maxLoginAttempts ||
				policy.value.loginBanDuration !== original.loginBanDuration)
		);
	});

	async function toggleBlacklist(enabled: boolean): Promise<void> {
		if (loading.value || needsRefresh.value || enabled === policy.value.blacklistEnabled) {
			return;
		}
		const original = snapshot.value;
		const previous = policy.value.blacklistEnabled;
		policy.value.blacklistEnabled = enabled;
		await saveNetwork({ blacklistEnabled: enabled });
		if (!success.value && snapshot.value === original) {
			policy.value.blacklistEnabled = previous;
		}
	}
</script>
<template>
	<div class="settings-surface space-y-3">
		<div class="ui-settings-groups">
			<UiSettingsGroup :title="t('settings.ipWhitelist.title')" icon="fa-solid fa-list-check" tone="info">
				<template #actions>
					<UiButton
						type="submit"
						form="ip-whitelist-form"
						:appearance="whitelistDirty ? 'solid' : 'soft'"
						:tone="whitelistDirty ? 'primary' : 'neutral'"
						:loading="loading"
						:disabled="!whitelistDirty || loading || needsRefresh"
						>{{ t('common.save') }}</UiButton
					>
				</template>
				<form id="ip-whitelist-form" class="space-y-4" @submit.prevent="saveNetwork()">
					<UiFormField :label="t('settings.ipWhitelist.label')" for-id="ipWhitelist">
						<UiTextarea
							id="ipWhitelist"
							v-model="policy.whitelist"
							:min-rows="4"
							class="font-mono"
							:disabled="loading || needsRefresh"
						/>
						<p class="mt-1 text-xs text-text-secondary">{{ t('settings.ipWhitelist.hint') }}</p>
					</UiFormField>
				</form>
			</UiSettingsGroup>

			<UiSettingsGroup :title="t('settings.ipBlacklist.title')" icon="fa-solid fa-shield-slash" tone="warning">
				<template #actions>
					<label class="flex items-center gap-2 text-xs font-medium text-text-secondary">
						<span>{{ policy.blacklistEnabled ? t('common.enabled') : t('common.disabled') }}</span>
						<UiSwitch
							:model-value="policy.blacklistEnabled"
							:disabled="loading || needsRefresh"
							:aria-label="t('settings.ipBlacklist.title')"
							@update:model-value="toggleBlacklist"
						/>
					</label>
					<UiButton
						v-if="policy.blacklistEnabled"
						type="submit"
						form="ip-blacklist-form"
						:appearance="blacklistDirty ? 'solid' : 'soft'"
						:tone="blacklistDirty ? 'primary' : 'neutral'"
						:loading="loading"
						:disabled="!blacklistDirty || loading || needsRefresh"
						>{{ t('common.save') }}</UiButton
					>
				</template>
				<template v-if="policy.blacklistEnabled">
					<form id="ip-blacklist-form" class="flex flex-wrap items-end gap-4" @submit.prevent="saveNetwork()">
						<UiFormField
							:label="t('settings.ipBlacklist.maxAttemptsLabel')"
							for-id="maxLoginAttempts"
							class="min-w-[150px] flex-1"
						>
							<UiNumberInput
								id="maxLoginAttempts"
								v-model="policy.maxLoginAttempts"
								min="1"
								:disabled="loading || needsRefresh"
							/>
						</UiFormField>
						<UiFormField
							:label="t('settings.ipBlacklist.banDurationLabel')"
							for-id="loginBanDuration"
							class="min-w-[150px] flex-1"
						>
							<UiNumberInput
								id="loginBanDuration"
								v-model="policy.loginBanDuration"
								min="1"
								:disabled="loading || needsRefresh"
							/>
						</UiFormField>
					</form>
					<div class="mt-5 space-y-3 rounded-xl bg-header/20 p-4">
						<h4 class="text-xs font-semibold text-foreground">
							{{ t('settings.ipBlacklist.currentBannedTitle') }}
						</h4>
						<UiTable
							v-if="!blacklistNeedsRefresh"
							:empty="entries.length === 0"
							:empty-text="t('settings.ipBlacklist.noBannedIps')"
						>
							<template #head>
								<tr>
									<th class="px-4 py-2 text-left font-medium text-text-secondary">IP</th>
									<th class="px-4 py-2 text-left font-medium text-text-secondary">
										{{ t('settings.ipBlacklist.table.attempts') }}
									</th>
									<th class="px-4 py-2 text-left font-medium text-text-secondary">
										{{ t('settings.ipBlacklist.table.lastAttempt') }}
									</th>
									<th class="px-4 py-2 text-left font-medium text-text-secondary">
										{{ t('settings.ipBlacklist.table.bannedUntil') }}
									</th>
									<th class="px-4 py-2 text-left font-medium text-text-secondary">
										{{ t('settings.ipBlacklist.table.actions') }}
									</th>
								</tr>
							</template>
							<tr v-for="entry in entries" :key="entry.ip" class="hover:bg-header/50">
								<td class="px-4 py-2 font-mono">{{ entry.ip }}</td>
								<td class="px-4 py-2">{{ entry.attempts }}</td>
								<td class="px-4 py-2">{{ new Date(entry.lastAttemptAtMs).toLocaleString() }}</td>
								<td class="px-4 py-2">
									{{ entry.blockedUntilMs ? new Date(entry.blockedUntilMs).toLocaleString() : '—' }}
								</td>
								<td class="px-4 py-2">
									<UiButton
										density="compact"
										appearance="solid"
										tone="danger"
										:disabled="blacklistLoading || blacklistNeedsRefresh"
										@click="remove(entry.ip)"
										>{{ t('common.remove') }}</UiButton
									>
								</td>
							</tr>
						</UiTable>
						<div class="flex items-center gap-3">
							<UiButton :disabled="blacklistLoading || offset === 0" @click="previous">←</UiButton
							><span class="text-xs text-text-secondary">{{ offset + entries.length }} / {{ total }}</span
							><UiButton :disabled="blacklistLoading || offset + pageSize >= total" @click="next"
								>→</UiButton
							>
						</div>
					</div>
				</template>
				<UiEmptyState
					v-else
					compact
					:bordered="false"
					icon="fa-solid fa-shield-halved"
					:title="t('common.disabled')"
				/>
			</UiSettingsGroup>
		</div>
	</div>
</template>
