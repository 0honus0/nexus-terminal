<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInlineNotice, UiInput, UiSettingsGroup } from '@/foundation/ui';
	import { useSettingsReloadSource } from '@/shared/feedback/public';
	import { useTwoFactorSettings } from '../composables/use-two-factor-settings';

	const props = defineProps<{ enabled: boolean }>();
	const emit = defineEmits<{ changed: [] }>();
	const { t } = useI18n();
	const {
		setup,
		verificationCode,
		disablePassword,
		loading,
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
	useSettingsReloadSource({
		id: 'security-two-factor',

		pending: () => !loading.value && needsRefresh.value,

		reload: refresh,
	});
</script>

<template>
	<UiSettingsGroup :title="t('settings.twoFactor.title')" icon="fa-solid fa-shield-halved" tone="warning">
		<template #actions>
			<UiButton
				v-if="!needsRefresh && !props.enabled && !setup"
				appearance="solid"
				tone="primary"
				:loading="loading"
				@click="begin"
				>{{ t('settings.twoFactor.enable.button') }}</UiButton
			>
			<UiButton
				v-else-if="!needsRefresh && props.enabled"
				type="submit"
				form="two-factor-disable-form"
				appearance="solid"
				tone="danger"
				:loading="loading"
				>{{ t('settings.twoFactor.disable.button') }}</UiButton
			>
		</template>
		<template v-if="!needsRefresh">
			<div v-if="props.enabled">
				<UiInlineNotice class="mb-3" tone="success">
					{{ t('settings.twoFactor.status.enabled') }}
				</UiInlineNotice>
				<form id="two-factor-disable-form" class="space-y-4" @submit.prevent="disable">
					<UiFormField :label="t('settings.twoFactor.disable.passwordPrompt')" for-id="disablePassword">
						<UiInput
							id="disablePassword"
							v-model="disablePassword"
							type="password"
							autocomplete="current-password"
						/>
					</UiFormField>
				</form>
			</div>
			<div v-else>
				<p class="mb-4 text-sm text-text-secondary">{{ t('settings.twoFactor.status.disabled') }}</p>
				<div v-if="setup" class="mt-4 space-y-4 rounded-xl bg-header/30 p-4">
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
							<UiButton type="button" :disabled="loading" @click="cancel">{{
								t('common.cancel')
							}}</UiButton>
						</div>
					</form>
				</div>
			</div>
		</template>
	</UiSettingsGroup>
</template>
