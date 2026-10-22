<script setup lang="ts">
	import { computed, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiFormField, UiInput, UiSelect, UiSettingsGroup } from '@/foundation/ui';
	import { useSettingsReloadSource } from '@/shared/feedback/public';
	import { useSecurityConfiguration } from '../composables/use-security-configuration';
	const { t } = useI18n();
	const {
		snapshot,
		captcha: form,
		loading,
		needsRefresh,
		refresh,
		saveCaptcha,
	} = useSecurityConfiguration('captcha');
	useSettingsReloadSource({
		id: 'security-captcha',

		pending: () => !loading.value && needsRefresh.value,

		reload: refresh,
	});
	const dirty = computed(() => {
		const original = snapshot.value?.captcha;
		if (!original) return false;
		return (
			form.value.enabled !== original.enabled ||
			form.value.provider !== original.provider ||
			form.value.siteKey !== original.siteKey ||
			form.value.hostname !== original.hostname ||
			form.value.secretAction !== 'keep'
		);
	});
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
	<UiSettingsGroup :title="t('settings.captcha.title')" icon="fa-solid fa-robot" tone="info">
		<template #actions>
			<UiButton
				type="submit"
				form="captcha-settings-form"
				:appearance="dirty ? 'solid' : 'soft'"
				:tone="dirty ? 'primary' : 'neutral'"
				:loading="loading"
				:disabled="!dirty || loading || needsRefresh"
				>{{ t('common.save') }}</UiButton
			>
		</template>
		<form id="captcha-settings-form" class="space-y-4" @submit.prevent="saveCaptcha">
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
				<div v-if="form.enabled && form.provider !== 'none'" class="space-y-4 rounded-xl bg-header/25 p-4">
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
			</fieldset>
		</form>
	</UiSettingsGroup>
</template>
