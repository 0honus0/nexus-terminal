<script setup lang="ts">
	import { onBeforeUnmount, onMounted, ref } from 'vue';
	import { useRouter } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import { createOidcApi, consumeOidcCallback, useAuthSession, authErrorKey } from '@/features/auth/public';
	import { UiButton, UiInlineNotice } from '@/foundation/ui';

	const { t } = useI18n();
	const router = useRouter();
	const auth = useAuthSession();
	const error = ref('');
	const controller = new AbortController();
	onBeforeUnmount(() => controller.abort());
	onMounted(async () => {
		try {
			const callback = consumeOidcCallback();
			const completed = await createOidcApi().finish(callback.purpose, callback.response, controller.signal);
			if (controller.signal.aborted) {
				return;
			}
			await auth.refreshSession();
			if (controller.signal.aborted) {
				return;
			}
			await router.replace(
				completed === 'binding' ? { name: 'Settings', query: { tab: 'security' } } : { name: 'Dashboard' },
			);
		} catch (cause) {
			if (!controller.signal.aborted) {
				error.value = t(authErrorKey(cause));
			}
		}
	});
</script>

<template>
	<main class="flex min-h-dvh items-center justify-center bg-app p-6">
		<section class="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-header p-6 text-center">
			<img src="@/assets/logo-small.png" alt="Nexus Terminal" class="mx-auto h-12 w-12" />
			<h1 class="text-lg font-semibold">{{ t('auth.oidc.completing') }}</h1>
			<UiInlineNotice v-if="error" tone="danger">{{ error }}</UiInlineNotice>
			<p v-if="error" class="text-sm text-text-secondary">{{ t('auth.oidc.retryHint') }}</p>
			<UiButton v-if="error" @click="router.replace({ name: 'Login' })">{{ t('auth.oidc.return') }}</UiButton>
			<span
				v-else
				class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"
				role="status"
				:aria-label="t('auth.oidc.completing')"
			/>
		</section>
	</main>
</template>
