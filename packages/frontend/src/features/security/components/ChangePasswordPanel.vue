<script setup lang="ts">
	import { onBeforeUnmount, onDeactivated, ref } from 'vue';
	import { useRouter } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import { authErrorKey, useAuthSession } from '@/features/auth/public';
	import { UiButton, UiFormField, UiInput } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';

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
				feedback.notifyError(message.value);
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
	<section>
		<h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.changePassword.title') }}</h3>
		<form class="space-y-4" @submit.prevent="submit">
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
			<div class="flex items-center justify-between gap-4">
				<UiButton type="submit" appearance="solid" tone="primary" :loading="loading">{{
					t('settings.changePassword.submit')
				}}</UiButton>
				<p v-if="message" class="text-sm text-error" role="status">
					{{ message }}
				</p>
			</div>
		</form>
	</section>
</template>
