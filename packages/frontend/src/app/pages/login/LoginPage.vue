<script setup lang="ts">
	import { onBeforeUnmount, onMounted, ref } from 'vue';
	import { useRouter } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import { authErrorKey, LoginView, type PasskeyLoginInput } from '@/features/auth/public';
	import { LoginCaptchaChallenge, useLoginSecurity } from '@/features/security/public';

	const router = useRouter();
	const { t } = useI18n();
	const security = useLoginSecurity();
	const captchaToken = ref<string | null>(null);
	const captchaFeedback = ref<string | null>(null);
	const captchaChallenge = ref<{ reset: () => void } | null>(null);
	const passkeyError = ref('');
	let disposed = false;
	onBeforeUnmount(() => {
		disposed = true;
	});
	onMounted(() => security.refresh());

	const handleLoginAttempted = () => {
		passkeyError.value = '';
		captchaFeedback.value = null;
	};

	const handleCaptchaToken = (token: string | null) => {
		captchaToken.value = token;
		if (token) captchaFeedback.value = null;
	};

	const loginWithPasskey = async (input: PasskeyLoginInput) => {
		passkeyError.value = '';
		captchaFeedback.value = null;
		try {
			await security.loginWithPasskey(input);
			if (disposed) {
				return;
			}
			await router.push({ name: 'Dashboard' });
		} catch (cause) {
			if (!disposed) {
				passkeyError.value = t(authErrorKey(cause));
			}
		}
	};
</script>
<template>
	<LoginView
		:captcha-required="security.captchaConfig.value.enabled"
		:captcha-token="captchaToken"
		:captcha-status="security.captchaStatus.value"
		:passkey-available="security.hasPasskeys.value"
		:passkey-loading="security.loading.value"
		@passkey="loginWithPasskey"
		@login-attempted="handleLoginAttempted"
		@security-challenge-feedback="captchaFeedback = $event"
		@security-challenge-consumed="captchaChallenge?.reset()"
	>
		<template #security>
			<LoginCaptchaChallenge
				ref="captchaChallenge"
				:config="security.captchaConfig.value"
				:status="security.captchaStatus.value"
				:feedback="captchaFeedback"
				@token="handleCaptchaToken"
			/>
			<div v-if="security.passkeyLoadError.value" class="text-center text-sm text-error" role="alert">
				{{ t('settings.passkey.error.discoveryFailed')
				}}<UiButton @click="security.refresh()">{{ t('common.retry') }}</UiButton>
			</div>
			<p v-if="passkeyError" class="mt-2 text-center text-sm text-error" role="alert">{{ passkeyError }}</p>
		</template>
	</LoginView>
</template>
