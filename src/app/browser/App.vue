<script setup lang="ts">
	import type { WindowLauncher } from '../../window/browser/window-plugin-api.js';
	import { useEventListener, usePreferredDark, usePreferredReducedMotion } from '@vueuse/core';
	import { computed, onScopeDispose, ref, shallowRef, watch, type Component } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { StateClient } from '../../state/browser/state-api.js';
	import { AuthPage, type AuthApi } from '../../auth/browser/auth-api.js';
	import { LogNotices, type LogApi } from '../../log/browser/log-api.js';
	import { SettingsPreferencesApi } from '../../settings/browser/settings-preferences-api.js';
	import type { PluginContributionList, PluginThemeEntry } from '../../plugin/plugin-api.browser.js';
	import type { PluginRuntimeInfo } from '../../plugin/plugin-state-types.js';
	import { UiSelect, UiTransition } from '../../ui/browser/ui-base-api.js';
	import { provideUiMotion } from '../../ui/browser/ui-motion-api.js';
	import { provideUiThemes } from '../../ui/browser/ui-theme-api.js';
	import AppStartup from './AppStartup.vue';

	const props = defineProps<{
		contributions: PluginContributionList;
		log: LogApi;
		auth: AuthApi;
		getState: () => Pick<StateClient, 'subscribe'> | undefined;
		getPluginRuntime: () => ReadonlyMap<string, PluginRuntimeInfo> | undefined;
		desktopPluginsReady: () => boolean;
		preparePlugins: () => void;
		windowLauncher: Pick<WindowLauncher, 'attach'>;
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

	function syncSessionPath(): void {
		const session = props.auth.state.value;
		const { pathname, search, hash } = location;
		if (!session || (pathname !== '/' && pathname !== '/login')) return;

		const target = session.account ? '/' : '/login';
		if (pathname !== target) history.replaceState(history.state, '', target + search + hash);
	}

	watch(props.auth.state, syncSessionPath, { immediate: true });
	useEventListener(window, 'popstate', syncSessionPath);

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

	// 认证首次读取在根组件挂载后启动，之后的后台刷新沿用原界面。
	const checkingSession = ref(true);
	watch(props.auth.checking, (checking) => {
		if (!checking) checkingSession.value = false;
	});

	const desktop = shallowRef<Component>();
	const desktopFailed = ref(false);
	const desktopReady = ref(false);
	let desktopLoad: Promise<void> | undefined;

	function loadDesktop(): Promise<void> {
		return (desktopLoad ??= import('./AppDesktop.vue')
			.then(({ default: component }) => {
				desktop.value = component;
			})
			.catch((cause: unknown) => {
				desktopLoad = undefined;
				throw cause;
			}));
	}

	function prepareHome(): void {
		props.preparePlugins();
		void loadDesktop().catch(() => undefined);
	}

	watch(
		signedIn,
		(active, _, onCleanup) => {
			if (!active) {
				desktopReady.value = false;
				return;
			}
			if (desktop.value) return;

			const scope = new AbortController();
			onCleanup(() => scope.abort());
			desktopFailed.value = false;
			void loadDesktop().catch(() => {
				if (scope.signal.aborted) return;
				desktopFailed.value = true;
				props.log.report({ source: 'app', level: 'error', code: 'APP_DESKTOP_LOAD_FAILED' });
			});
		},
		{ immediate: true },
	);

	function reload(): void {
		location.reload();
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
	<UiTransition preset="fade" :appear="false">
		<AppStartup
			v-if="checkingSession || (signedIn && !desktopReady)"
			:motion-enabled="motionEnabled"
			:failed="desktopFailed"
			@retry="reload"
		/>
	</UiTransition>
	<AuthPage v-if="!signedIn && !checkingSession" :auth="auth" :contributions="contributions" @sign-in="prepareHome" />
	<UiSelect
		v-if="!signedIn && !checkingSession"
		v-model="language"
		class="app-language"
		:options="languageOptions"
		:aria-label="t('language')"
	/>
	<component
		:is="desktop"
		v-if="signedIn && !checkingSession && desktop"
		v-model:preview-speed="previewSpeed"
		:plugins-ready="desktopPluginsReady()"
		:preferences="preferences"
		:auth="auth"
		:contributions="contributions"
		:log="log"
		:state="getState()"
		:plugin-runtime="getPluginRuntime()"
		:signing-out="signingOut"
		:window-launcher="windowLauncher"
		@ready="desktopReady = true"
		@logout="logout"
	/>
</template>
