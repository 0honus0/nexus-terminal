<script setup lang="ts">
	import { watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiFormField, UiInput, UiSelect } from '@/foundation/ui';
	import { useSecurityConfiguration } from '../composables/use-security-configuration';
	import ConfigurationStatus from './ConfigurationStatus.vue';
	const { t } = useI18n();
	const {
		snapshot,
		captcha: form,
		loading,
		needsRefresh,
		message,
		success,
		refresh,
		saveCaptcha,
	} = useSecurityConfiguration();
	watch(
		[() => form.value.enabled, () => form.value.provider],
		() => {
			form.value.secretValue = '';
			if (form.value.secretAction === 'replace') {
				form.value.secretAction = 'keep';
			}
		},
		{ flush: 'sync' },
	);
</script>
<template>
	<section>
		<h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.captcha.title') }}</h3>
		<p class="mb-4 text-sm text-text-secondary">{{ t('settings.captcha.description') }}</p>
		<ConfigurationStatus
			:pending-restart="snapshot?.pendingRestart"
			:loading="loading"
			:needs-refresh="needsRefresh"
			:message="message"
			:success="success"
			@refresh="refresh"
		/>
		<form class="space-y-4" @submit.prevent="saveCaptcha">
			<fieldset :disabled="loading || needsRefresh" class="space-y-4">
				<label class="flex items-center gap-2 text-sm"
					><UiCheckbox :disabled="loading || needsRefresh" v-model="form.enabled" />{{
						t('settings.captcha.enableLabel')
					}}</label
				>
				<UiFormField :label="t('settings.captcha.providerLabel')" for-id="captcha-provider">
					<UiSelect :disabled="loading || needsRefresh" id="captcha-provider" v-model="form.provider"
						><option value="none">{{ t('settings.captcha.providerNone') }}</option>
						<option value="hcaptcha">hCaptcha</option>
						<option value="recaptcha">reCAPTCHA</option></UiSelect
					>
				</UiFormField>
				<div
					v-if="form.enabled && form.provider !== 'none'"
					class="ml-1 space-y-4 border-l-2 border-border/50 pl-4 pt-2"
				>
					<p class="text-xs text-text-secondary">
						{{
							t(
								form.provider === 'hcaptcha'
									? 'settings.captcha.hcaptchaHint'
									: 'settings.captcha.recaptchaHint',
							)
						}}
						<a
							:href="
								form.provider === 'hcaptcha'
									? 'https://www.hcaptcha.com/'
									: 'https://www.google.com/recaptcha/'
							"
							target="_blank"
							rel="noopener noreferrer"
							class="text-primary hover:underline"
							>{{
								t(
									form.provider === 'hcaptcha'
										? 'settings.captcha.hcaptchaProviderName'
										: 'settings.captcha.recaptchaProviderName',
								)
							}}</a
						>
					</p>
					<UiFormField :label="t('settings.captcha.siteKeyLabel')" for-id="captcha-site"
						><UiInput id="captcha-site" v-model="form.siteKey" autocomplete="off"
					/></UiFormField>
					<UiFormField :label="t('settings.configuration.hostname')" for-id="captcha-hostname"
						><UiInput id="captcha-hostname" v-model="form.hostname"
					/></UiFormField>
					<p>
						{{
							t(
								snapshot?.captcha.hasSecret
									? 'settings.configuration.hasSecret'
									: 'settings.configuration.noSecret',
							)
						}}
					</p>
					<UiFormField :label="t('settings.captcha.secretKeyLabel')" for-id="captcha-secret-action">
						<UiSelect
							:disabled="loading || needsRefresh"
							id="captcha-secret-action"
							v-model="form.secretAction"
							><option value="keep">{{ t('settings.configuration.keepSecret') }}</option>
							<option value="clear">{{ t('settings.configuration.clearSecret') }}</option>
							<option value="replace">{{ t('settings.configuration.replaceSecret') }}</option></UiSelect
						>
					</UiFormField>
					<UiInput
						v-if="form.secretAction === 'replace'"
						id="captcha-secret"
						v-model="form.secretValue"
						type="password"
						autocomplete="new-password"
						:aria-label="t('settings.captcha.secretKeyLabel')"
					/>
					<p class="text-xs text-text-secondary">{{ t('settings.captcha.secretKeyHint') }}</p>
				</div>
				<UiButton
					type="submit"
					appearance="solid"
					tone="primary"
					:loading="loading"
					:disabled="loading || needsRefresh"
					>{{ t('common.save') }}</UiButton
				>
			</fieldset>
		</form>
	</section>
</template>
