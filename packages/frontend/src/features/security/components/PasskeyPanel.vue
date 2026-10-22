<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInput, UiSettingsGroup } from '@/foundation/ui';
	import { useSettingsReloadSource } from '@/shared/feedback/public';
	import { usePasskeySettings } from '../composables/use-passkey-settings';

	const { t } = useI18n();
	const { passkeys, names, editing, loading, needsRefresh, refresh, register, saveName, remove } =
		usePasskeySettings();
	useSettingsReloadSource({
		id: 'security-passkeys',

		pending: () => !loading.value && needsRefresh.value,

		reload: refresh,
	});

	const formatDate = (value: number | null) => (value === null ? '—' : new Date(value).toLocaleString());
</script>

<template>
	<UiSettingsGroup :title="t('settings.passkey.title')" icon="fa-solid fa-fingerprint" tone="primary">
		<template #actions>
			<UiButton appearance="solid" tone="primary" :loading="loading" :disabled="needsRefresh" @click="register">{{
				t('settings.passkey.registerNewButton')
			}}</UiButton>
		</template>

		<div class="mt-5">
			<h4 class="mb-3 text-xs font-semibold text-foreground">
				{{ t('settings.passkey.registeredKeysTitle') }}
			</h4>
			<div v-if="loading && passkeys.length === 0" class="p-4 text-center text-text-secondary italic">
				{{ t('common.loading') }}
			</div>
			<ul v-else-if="passkeys.length" class="space-y-3">
				<li
					v-for="key in passkeys"
					:key="key.credentialId"
					class="flex flex-col items-start justify-between rounded-md border border-border bg-header/20 p-3 transition-colors duration-150 hover:bg-header/40 sm:flex-row sm:items-center"
				>
					<div class="mb-2 flex-grow sm:mb-0">
						<div class="flex items-center">
							<template v-if="editing !== key.credentialId">
								<span class="block text-sm font-medium text-foreground">
									{{ key.name || t('settings.passkey.unnamedKey') }}
									<span class="ml-1 text-xs text-text-secondary"
										>(ID: ...{{ key.credentialId.slice(-8) }})</span
									>
								</span>
								<UiButton
									type="button"
									appearance="ghost"
									density="compact"
									icon-only
									class="ml-2"
									:title="t('common.edit')"
									:aria-label="t('common.edit')"
									:disabled="loading || needsRefresh"
									@click="editing = key.credentialId"
								>
									<i class="fa-solid fa-pen text-[10px]" aria-hidden="true"></i>
								</UiButton>
							</template>
							<div v-else class="flex flex-grow items-center">
								<UiInput
									v-model="names[key.credentialId]"
									class="!w-48"
									:placeholder="t('settings.passkey.namePlaceholder')"
									@keyup.enter="saveName(key)"
									@keyup.esc="editing = null"
								/>
								<UiButton
									class="ml-2"
									density="compact"
									appearance="solid"
									tone="primary"
									:disabled="loading || needsRefresh"
									@click="saveName(key)"
									>{{ t('common.save') }}</UiButton
								>
								<UiButton
									class="ml-1"
									density="compact"
									:disabled="loading || needsRefresh"
									@click="editing = null"
									>{{ t('common.cancel') }}</UiButton
								>
							</div>
						</div>
						<div class="mt-1 space-x-2 text-xs text-text-secondary">
							<span>{{ t('settings.passkey.createdDate') }}: {{ formatDate(key.createdAtMs) }}</span>
							<span v-if="key.lastUsedAtMs"
								>{{ t('settings.passkey.lastUsedDate') }}: {{ formatDate(key.lastUsedAtMs) }}</span
							>
							<span v-if="key.transports?.length" class="capitalize"
								>({{ key.transports.join(', ') }})</span
							>
						</div>
					</div>
					<UiButton
						density="compact"
						appearance="solid"
						tone="danger"
						class="self-start sm:self-center"
						:disabled="loading || needsRefresh || editing === key.credentialId"
						@click="remove(key)"
						>{{ t('common.delete') }}</UiButton
					>
				</li>
			</ul>
			<p v-else-if="!needsRefresh" class="text-sm text-text-secondary italic">
				{{ t('settings.passkey.noKeysRegistered') }}
			</p>
		</div>
	</UiSettingsGroup>
</template>
