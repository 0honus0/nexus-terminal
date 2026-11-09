<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInput, UiSelect, UiSettingsGroup } from '@/foundation/ui';
	import { useSettingsReloadSource } from '@/shared/feedback/public';
	import { useOidcSettings } from '../composables/use-oidc-settings';

	const { t } = useI18n();
	const { settings, password, secret, busy, needsRefresh, dirty, refresh, save, bind, unbind } = useOidcSettings();
	const form = computed(() => {
		const current = settings.value;
		if (current === null) {
			throw new Error('OIDC settings are not loaded');
		}
		return current;
	});
	useSettingsReloadSource({
		id: 'security-oidc',

		pending: () => !busy.value && needsRefresh.value,

		reload: refresh,
	});
</script>

<template>
	<UiSettingsGroup :title="t('settings.oidc.title')" icon="fa-solid fa-id-card" tone="info">
		<template #actions>
			<UiButton
				type="submit"
				form="oidc-settings-form"
				:appearance="dirty ? 'solid' : 'soft'"
				:tone="dirty ? 'primary' : 'neutral'"
				:loading="busy"
				:disabled="!dirty || busy || needsRefresh || !password"
				>{{ t('common.save') }}</UiButton
			>
		</template>
		<form v-if="settings" id="oidc-settings-form" class="space-y-4" @submit.prevent="save">
			<fieldset class="space-y-4 min-w-0" :disabled="busy || needsRefresh">
				<p class="text-sm text-text-secondary">{{ t('settings.oidc.description') }}</p>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<UiFormField :label="t('settings.oidc.label')" for-id="oidc-label"
						><UiInput id="oidc-label" v-model="form.label" required
					/></UiFormField>
					<UiFormField label="Issuer URL" for-id="oidc-issuer"
						><UiInput
							id="oidc-issuer"
							v-model="form.issuer"
							type="url"
							placeholder="https://id.example.com"
							required
					/></UiFormField>
					<UiFormField label="Client ID" for-id="oidc-client"
						><UiInput id="oidc-client" v-model="form.clientId" autocomplete="off" required
					/></UiFormField>
					<UiFormField :label="t('settings.oidc.authentication')" for-id="oidc-authentication"
						><UiSelect id="oidc-authentication" v-model="form.clientAuthentication"
							><option value="client_secret_basic">Client Secret Basic</option>
							<option value="client_secret_post">Client Secret POST</option>
							<option value="none">{{ t('settings.oidc.publicClient') }}</option></UiSelect
						></UiFormField
					>
				</div>
				<UiFormField v-if="form.clientAuthentication !== 'none'" label="Client Secret" for-id="oidc-secret"
					><UiInput
						id="oidc-secret"
						v-model="secret"
						type="password"
						autocomplete="new-password"
						:placeholder="form.hasSecret ? t('settings.oidc.secretKept') : ''"
						:required="!form.hasSecret"
				/></UiFormField>
				<UiFormField :label="t('settings.oidc.callback')" for-id="oidc-callback"
					><UiInput id="oidc-callback" :model-value="form.callbackUrl" readonly
				/></UiFormField>
				<UiFormField :label="t('settings.changePassword.currentPassword')" for-id="oidc-password"
					><UiInput
						id="oidc-password"
						v-model="password"
						type="password"
						autocomplete="current-password"
						required
				/></UiFormField>
				<div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
					<span class="text-sm" :class="form.bound ? 'text-status-success' : 'text-text-secondary'">{{
						t(form.bound ? 'settings.oidc.bound' : 'settings.oidc.unbound')
					}}</span>
					<UiButton
						v-if="form.bound"
						type="button"
						tone="danger"
						:disabled="busy || needsRefresh || dirty || !password"
						@click="unbind"
						>{{ t('settings.oidc.unbind') }}</UiButton
					>
					<UiButton
						v-else
						type="button"
						:disabled="busy || needsRefresh || dirty || !form.revision || !password"
						@click="bind"
						>{{ t('settings.oidc.bind') }}</UiButton
					>
				</div>
				<p class="text-xs text-text-secondary">{{ t('settings.oidc.hint') }}</p>
			</fieldset>
		</form>
	</UiSettingsGroup>
</template>
