<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInput } from '@/foundation/ui';
	import { useTwoFactorSettings } from '../composables/use-two-factor-settings';

	const props = defineProps<{ enabled: boolean }>();
	const emit = defineEmits<{ changed: [] }>();
	const { t } = useI18n();
	const {
		setup,
		verificationCode,
		disablePassword,
		loading,
		message,
		success,
		needsRefresh,
		begin,
		activate,
		disable,
		refresh,
		cancel,
	} = useTwoFactorSettings(
		() => props.enabled,
		() => emit('changed'),
	);
</script>

<template>
	<section>
		<h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.twoFactor.title') }}</h3>
		<UiButton v-if="needsRefresh" :loading="loading" @click="refresh">{{ t('common.retry') }}</UiButton>
		<div v-else-if="props.enabled">
			<p class="mb-3 rounded border-l-4 border-success bg-success/10 p-3 text-sm text-success">
				{{ t('settings.twoFactor.status.enabled') }}
			</p>
			<form class="space-y-4" @submit.prevent="disable">
				<UiFormField :label="t('settings.twoFactor.disable.passwordPrompt')" for-id="disablePassword">
					<UiInput
						id="disablePassword"
						v-model="disablePassword"
						type="password"
						autocomplete="current-password"
					/>
				</UiFormField>
				<UiButton type="submit" appearance="solid" tone="danger" :loading="loading">{{
					t('settings.twoFactor.disable.button')
				}}</UiButton>
			</form>
		</div>
		<div v-else>
			<p class="mb-4 text-sm text-text-secondary">{{ t('settings.twoFactor.status.disabled') }}</p>
			<UiButton v-if="!setup" appearance="solid" tone="primary" :loading="loading" @click="begin">{{
				t('settings.twoFactor.enable.button')
			}}</UiButton>
			<div v-else class="mt-4 space-y-4 rounded-md border border-border bg-header/30 p-4">
				<p class="text-sm text-text-secondary">{{ t('settings.twoFactor.setup.scanQrCode') }}</p>
				<img
					:src="setup.qrCodeUrl"
					:alt="t('settings.twoFactor.qrCodeAlt')"
					class="mx-auto block max-w-[180px] rounded border border-border bg-white p-1"
				/>
				<p class="text-sm text-text-secondary">
					{{ t('settings.twoFactor.setup.orEnterSecret') }}
					<code class="rounded border border-border/50 bg-header/50 px-2 py-1 font-mono text-sm">{{
						setup.secret
					}}</code>
				</p>
				<form class="space-y-4" @submit.prevent="activate">
					<UiFormField :label="t('settings.twoFactor.setup.enterCode')" for-id="verificationCode">
						<UiInput
							id="verificationCode"
							v-model="verificationCode"
							inputmode="numeric"
							pattern="[0-9]{6}"
							autocomplete="one-time-code"
						/>
					</UiFormField>
					<div class="flex items-center gap-3">
						<UiButton type="submit" appearance="solid" tone="primary" :loading="loading">{{
							t('settings.twoFactor.setup.verifyButton')
						}}</UiButton>
						<UiButton type="button" :disabled="loading" @click="cancel">{{ t('common.cancel') }}</UiButton>
					</div>
				</form>
			</div>
		</div>
		<p v-if="message" :class="success ? 'text-success' : 'text-error'" class="mt-3 text-sm" role="status">
			{{ message }}
		</p>
	</section>
</template>
