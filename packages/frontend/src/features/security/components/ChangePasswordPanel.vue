<script setup lang="ts">
	import { computed, onBeforeUnmount, onDeactivated, ref } from 'vue';
	import { useRouter } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import { authErrorKey, useAuthSession } from '@/features/auth/public';
	import { UiButton, UiFormField, UiInput, UiSettingsGroup } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import { isNetworkFailure } from '@/client/http/network-failure';

	const { t } = useI18n();
	const feedback = useFeedback();
	const auth = useAuthSession();
	const router = useRouter();
	let disposed = false;
	onBeforeUnmount(() => {
		disposed = true;
		clearPasswords();
	});
	const currentPassword = ref('');
	const newPassword = ref('');
	const confirmPassword = ref('');
	const loading = ref(false);
	const message = ref('');
	const canSubmit = computed(() => Boolean(currentPassword.value && newPassword.value && confirmPassword.value));

	function clearPasswords(): void {
		currentPassword.value = '';
		newPassword.value = '';
		confirmPassword.value = '';
	}

	onDeactivated(clearPasswords);

	const submit = async () => {
		if (loading.value || disposed) {
			return;
		}
		message.value = '';
		if (!currentPassword.value || !newPassword.value) {
			message.value = t('settings.changePassword.error.fieldsRequired');
			feedback.notifyError(message.value);
			return;
		}
		if (newPassword.value !== confirmPassword.value) {
			message.value = t('settings.changePassword.error.passwordsDoNotMatch');
			feedback.notifyError(message.value);
			return;
		}
		const originRoute = router.currentRoute.value;
		loading.value = true;
		let completed = false;
		try {
			await auth.changePassword(currentPassword.value, newPassword.value);
			completed = true;
		} catch (cause) {
			if (!disposed) {
				message.value = t(authErrorKey(cause));
				if (!isNetworkFailure(cause)) feedback.notifyError(message.value);
			}
		} finally {
			if (!disposed) {
				loading.value = false;
				clearPasswords();
			}
		}
		if (router.currentRoute.value !== originRoute) {
			return;
		}
		if (completed) {
			feedback.notifySuccess(t('settings.changePassword.success'));
		}
		// Session invalidation can rebuild the cached page before this continuation.
		// Finish navigation for this route, but never redirect a subsequent user action.
		if (!auth.isAuthenticated.value) {
			try {
				await router.replace({ name: 'Login' });
			} catch {
				feedback.notifyError(t('auth.errors.generic'));
			}
		}
	};
</script>

<template>
	<UiSettingsGroup :title="t('settings.changePassword.title')" icon="fa-solid fa-key" tone="success">
		<template #actions>
			<UiButton
				type="submit"
				form="change-password-form"
				:appearance="canSubmit ? 'solid' : 'soft'"
				:tone="canSubmit ? 'primary' : 'neutral'"
				:loading="loading"
				:disabled="!canSubmit || loading"
				>{{ t('settings.changePassword.submit') }}</UiButton
			>
		</template>
		<form id="change-password-form" class="space-y-4" @submit.prevent="submit">
			<UiFormField :label="t('settings.changePassword.currentPassword')" for-id="currentPassword">
				<UiInput
					id="currentPassword"
					v-model="currentPassword"
					type="password"
					autocomplete="current-password"
				/>
			</UiFormField>
			<UiFormField :label="t('settings.changePassword.newPassword')" for-id="newPassword">
				<UiInput id="newPassword" v-model="newPassword" type="password" autocomplete="new-password" />
			</UiFormField>
			<UiFormField :label="t('settings.changePassword.confirmPassword')" for-id="confirmPassword">
				<UiInput id="confirmPassword" v-model="confirmPassword" type="password" autocomplete="new-password" />
			</UiFormField>
		</form>
	</UiSettingsGroup>
</template>
