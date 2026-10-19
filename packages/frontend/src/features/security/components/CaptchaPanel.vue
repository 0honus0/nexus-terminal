<script setup lang="ts">
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
</script>
<template>
	<section class="space-y-4">
		<h3 class="text-base font-semibold text-foreground">{{ t('settings.captcha.title') }}</h3>
		<p class="text-sm text-text-secondary">{{ t('settings.captcha.description') }}</p>
		<ConfigurationStatus
			:revision="snapshot?.revision"
			:effective-revision="snapshot?.effectiveRevision"
			:pending-restart="snapshot?.pendingRestart"
			:loading="loading"
			:needs-refresh="needsRefresh"
			:message="message"
			:success="success"
			@refresh="refresh"
		/>
		<form class="space-y-4" @submit.prevent="saveCaptcha">
			<fieldset :disabled="loading || needsRefresh" class="space-y-4">
				<label class="flex gap-2"
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
					<UiSelect :disabled="loading || needsRefresh" id="captcha-secret-action" v-model="form.secretAction"
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
