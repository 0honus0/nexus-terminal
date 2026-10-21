<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiFormField, UiInput, UiTable, UiTextarea } from '@/foundation/ui';
	import { useSecurityConfiguration } from '../composables/use-security-configuration';
	import { useIpBlacklist } from '../composables/use-ip-blacklist';
	import ConfigurationStatus from './ConfigurationStatus.vue';
	const { t } = useI18n();
	const {
		snapshot,
		network: policy,
		loading,
		needsRefresh,
		message,
		success,
		refresh,
		saveNetwork,
	} = useSecurityConfiguration();
	const {
		entries,
		total,
		offset,
		pageSize,
		loading: blacklistLoading,
		needsRefresh: blacklistNeedsRefresh,
		message: blacklistMessage,
		refresh: refreshBlacklist,
		previous,
		next,
		remove,
	} = useIpBlacklist();

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
	<div class="space-y-6">
		<ConfigurationStatus
			:pending-restart="snapshot?.pendingRestart"
			:loading="loading"
			:needs-refresh="needsRefresh"
			:message="message"
			:success="success"
			@refresh="refresh"
		/>
		<section class="ui-solid-panel overflow-hidden rounded-xl">
			<h2 class="border-b border-border/60 px-6 py-4 text-lg font-semibold text-foreground">
				{{ t('settings.ipWhitelist.title') }}
			</h2>
			<div class="p-6">
				<p class="mb-4 text-sm text-text-secondary">{{ t('settings.ipWhitelist.description') }}</p>
				<form class="space-y-4" @submit.prevent="saveNetwork()">
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
					<div class="flex items-center justify-between gap-4">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="loading"
							:disabled="loading || needsRefresh"
							>{{ t('common.save') }}</UiButton
						>
						<p v-if="message" :class="success ? 'text-success' : 'text-error'" class="text-sm">
							{{ message }}
						</p>
					</div>
				</form>
			</div>
		</section>

		<section class="ui-solid-panel overflow-hidden rounded-xl">
			<div class="flex items-center justify-between border-b border-border/60 px-6 py-4">
				<h2 class="text-lg font-semibold text-foreground">{{ t('settings.ipBlacklist.title') }}</h2>
				<label class="flex items-center gap-2 text-sm">
					<UiCheckbox
						:model-value="policy.blacklistEnabled"
						:disabled="loading || needsRefresh"
						role="switch"
						:aria-checked="String(policy.blacklistEnabled)"
						@update:model-value="toggleBlacklist"
					/>
					<span>{{ policy.blacklistEnabled ? t('common.enabled') : t('common.disabled') }}</span>
				</label>
			</div>
			<div class="space-y-6 p-6">
				<template v-if="policy.blacklistEnabled">
					<p class="text-sm text-text-secondary">{{ t('settings.ipBlacklist.description') }}</p>
					<form class="flex flex-wrap items-end gap-4" @submit.prevent="saveNetwork()">
						<UiFormField
							:label="t('settings.ipBlacklist.maxAttemptsLabel')"
							for-id="maxLoginAttempts"
							class="min-w-[150px] flex-1"
						>
							<UiInput
								id="maxLoginAttempts"
								v-model="policy.maxLoginAttempts"
								type="number"
								min="1"
								:disabled="loading || needsRefresh"
							/>
						</UiFormField>
						<UiFormField
							:label="t('settings.ipBlacklist.banDurationLabel')"
							for-id="loginBanDuration"
							class="min-w-[150px] flex-1"
						>
							<UiInput
								id="loginBanDuration"
								v-model="policy.loginBanDuration"
								type="number"
								min="1"
								:disabled="loading || needsRefresh"
							/>
						</UiFormField>
						<UiButton type="submit" appearance="solid" tone="primary" :loading="loading">{{
							t('common.save')
						}}</UiButton>
					</form>
					<p v-if="message" :class="success ? 'text-success' : 'text-error'" class="text-sm">{{ message }}</p>
					<hr class="border-border/50" />
					<h3 class="text-base font-semibold text-foreground">
						{{ t('settings.ipBlacklist.currentBannedTitle') }}
					</h3>
					<p v-if="blacklistMessage" class="text-sm text-error" role="alert">{{ blacklistMessage }}</p>
					<UiButton v-if="blacklistNeedsRefresh && !blacklistLoading" @click="refreshBlacklist">{{
						t('common.retry')
					}}</UiButton>
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
						><span>{{ offset + entries.length }} / {{ total }}</span
						><UiButton :disabled="blacklistLoading || offset + pageSize >= total" @click="next">→</UiButton>
					</div>
				</template>
				<div
					v-else
					class="rounded-md border border-dashed border-border/50 p-4 text-center text-text-secondary italic"
				>
					{{ t('common.disabled') }}
				</div>
			</div>
		</section>
	</div>
</template>
