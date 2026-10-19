<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInput } from '@/foundation/ui';
	import { usePasskeySettings } from '../composables/use-passkey-settings';

	const { t } = useI18n();
	const { passkeys, names, editing, loading, needsRefresh, message, success, refresh, register, saveName, remove } =
		usePasskeySettings();

	const formatDate = (value: number | null) => (value === null ? '—' : new Date(value).toLocaleString());
</script>

<template>
	<section>
		<h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.passkey.title') }}</h3>
		<p class="mb-4 text-sm text-text-secondary">{{ t('settings.passkey.description') }}</p>
		<UiButton appearance="solid" tone="primary" :loading="loading" :disabled="needsRefresh" @click="register">{{
			t('settings.passkey.registerNewButton')
		}}</UiButton>
		<p v-if="message" :class="success ? 'text-success' : 'text-error'" class="mt-3 text-sm" role="status">
			{{ message }}
		</p>

		<UiButton v-if="needsRefresh" :loading="loading" @click="refresh">{{ t('common.retry') }}</UiButton>

		<div class="mt-6">
			<h4 class="mb-3 text-base font-semibold text-foreground">
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
								<button
									type="button"
									class="ml-2 p-1 text-text-secondary transition hover:text-foreground"
									:title="t('common.edit')"
									:disabled="loading || needsRefresh"
									@click="editing = key.credentialId"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="14"
										height="14"
										fill="currentColor"
										viewBox="0 0 16 16"
										aria-hidden="true"
									>
										<path
											d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"
										/>
										<path
											fill-rule="evenodd"
											d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"
										/>
									</svg>
								</button>
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
	</section>
</template>
