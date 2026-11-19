<script setup lang="ts">
	import { usePreferredDark, usePreferredReducedMotion } from '@vueuse/core';
	import { computed, defineAsyncComponent, onScopeDispose, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { StateClient } from '../../state/browser/state-api.js';
	import { AuthPage, type AuthApi } from '../../auth/browser/auth-api.js';
	import { LogNotices, type LogApi } from '../../log/browser/log-api.js';
	import { SettingsPreferencesApi } from '../../settings/browser/settings-preferences-api.js';
	import type { PluginContributionList, PluginThemeEntry } from '../../plugin/plugin-api.browser.js';
	import { UiSelect } from '../../ui/browser/ui-base-api.js';
	import { provideUiMotion } from '../../ui/browser/ui-motion-api.js';
	import { provideUiThemes } from '../../ui/browser/ui-theme-api.js';

	const props = defineProps<{
		contributions: PluginContributionList;
		log: LogApi;
		auth: AuthApi;
		getState: () => Pick<StateClient, 'subscribe'> | undefined;
		preparePlugins: () => void;
	}>();
	const { locale, t } = useI18n({ useScope: 'global' });
	const preferences = new SettingsPreferencesApi({
		locale: locale.value === 'zh' ? 'zh' : 'en',
		log: props.log,
	});
	const settings = preferences.value;
	const languageOptions = [
		{ value: 'en', label: 'English' },
		{ value: 'zh', label: '简体中文' },
	];
	const language = computed({
		get: () => locale.value,

		set: (value: string | undefined) => {
			if (value === 'en' || value === 'zh') preferences.update({ locale: value });
		},
	});
	const signedIn = computed(() => !!props.auth.state.value?.account);
	const signingOut = ref(false);
	const previewSpeed = ref<number>();
	const reducedMotion = usePreferredReducedMotion();
	const motionEnabled = computed(() => settings.value.motionEffects && reducedMotion.value !== 'reduce');
	const motionSpeed = computed(() => previewSpeed.value ?? settings.value.animationSpeed);
	provideUiMotion({ enabled: motionEnabled, speed: motionSpeed });
	watch(
		[motionEnabled, motionSpeed],
		([enabled, speed]) => {
			document.documentElement.dataset.uiMotion = enabled ? 'full' : 'reduced';
			document.documentElement.style.setProperty('--ui-motion-speed', String(speed));
		},
		{ immediate: true },
	);
	watch(
		[signedIn, () => props.getState()],
		([active, state]) => {
			if (active) preferences.connect(state);
			else preferences.disconnect();
		},
		{ immediate: true },
	);
	onScopeDispose(() => preferences.disconnect());

	const loadDesktop = () => import('./AppDesktop.vue');

	const Desktop = defineAsyncComponent(loadDesktop);

	function prepareHome(): void {
		props.preparePlugins();
		void loadDesktop().catch(() => undefined);
	}

	const dark = usePreferredDark();
	const selectedTheme = computed({
		get: () => settings.value.themeId,

		set: (themeId) => preferences.update({ themeId }),
	});
	const themes = provideUiThemes(document.documentElement, selectedTheme);
	const registeredThemes = new Map<PluginThemeEntry, () => void>();

	watch(
		() => props.contributions.value.filter((entry) => entry.kind === 'themes'),
		(entries) => {
			const current = new Set(entries);
			for (const [entry, dispose] of registeredThemes) {
				if (current.has(entry)) continue;
				dispose();
				registeredThemes.delete(entry);
			}
			for (const entry of entries) {
				if (!entry.lifetime.signal.aborted && !registeredThemes.has(entry))
					registeredThemes.set(entry, themes.scope(entry.context.self.id).registerTheme(entry));
			}
		},
		{ immediate: true },
	);
	onScopeDispose(() => registeredThemes.clear());

	watch(
		[dark, () => settings.value.theme],
		([systemDark, mode]) => {
			document.documentElement.dataset.uiMode =
				mode === 'dark' || (mode === 'system' && systemDark) ? 'dark' : 'light';
		},
		{ immediate: true },
	);

	watch(
		() => settings.value.locale,
		(language) => {
			locale.value = language;
			document.documentElement.lang = language;
		},
		{ immediate: true },
	);

	async function logout(): Promise<void> {
		if (signingOut.value) return;
		signingOut.value = true;
		try {
			await props.auth.logout();
		} catch (cause) {
			props.auth.reportFailure(cause);
		} finally {
			signingOut.value = false;
		}
	}
</script>

<template>
	<LogNotices :log="log" />
	<AuthPage v-if="!signedIn" :auth="auth" :contributions="contributions" @sign-in="prepareHome" />
	<UiSelect
		v-if="!signedIn"
		v-model="language"
		class="app-language"
		:options="languageOptions"
		:aria-label="t('language')"
	/>
	<Desktop
		v-else
		v-model:preview-speed="previewSpeed"
		:preferences="preferences"
		:auth="auth"
		:contributions="contributions"
		:log="log"
		:state="getState()"
		:signing-out="signingOut"
		@logout="logout"
	/>
</template>
