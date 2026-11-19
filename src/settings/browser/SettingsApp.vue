<script setup lang="ts">
	import {
		Globe,
		Keyboard,
		KeyRound,
		LogOut,
		Monitor,
		Moon,
		Palette,
		ShieldCheck,
		Sparkles,
		Sun,
		UserRound,
	} from '@lucide/vue';
	import { usePreferredReducedMotion } from '@vueuse/core';
	import { computed, onScopeDispose, ref, useId, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { AuthApi } from '../../auth/browser/auth-api.js';
	import type { LogApi } from '../../log/browser/log-api.js';
	import {
		UiButton,
		UiField,
		UiFormRow,
		UiInput,
		UiSection,
		UiSelect,
		UiSlider,
		UiSwitch,
	} from '../../ui/browser/ui-components-api.js';
	import { useUiThemes } from '../../ui/browser/ui-theme-api.js';
	import { AnimationSpeedSchema } from '../settings-types.js';
	import type { SettingsPreferencesApi } from './settings-preferences-api.js';

	const { auth, preferences, log, minimized } = defineProps<{
		signingOut: boolean;
		minimized: boolean;
		auth: AuthApi;
		preferences: SettingsPreferencesApi;
		log: Pick<LogApi, 'report'>;
	}>();
	const emit = defineEmits<{ logout: [] }>();
	const previewSpeed = defineModel<number>('previewSpeed');
	const state = preferences.value;
	const reducedMotion = usePreferredReducedMotion();
	const motionEnabled = computed(() => state.value.motionEffects && reducedMotion.value !== 'reduce');
	const { t, n } = useI18n({ useScope: 'global' });
	const themeApi = useUiThemes().api;
	const speedLabel = useId();
	const languages = [
		{ value: 'en', label: 'English' },
		{ value: 'zh', label: '简体中文' },
	];
	const themes = [
		{ value: 'light', icon: Sun },
		{ value: 'dark', icon: Moon },
		{ value: 'system', icon: Monitor },
	] as const;
	const themeOptions = computed(() => {
		const options = [
			{ value: 'builtin', label: t('desktop.builtinTheme') },
			...themeApi.themes.value.map(({ id, label }) => ({ value: id, label })),
		];
		if (state.value.themeId && !options.some(({ value }) => value === state.value.themeId))
			options.push({ value: state.value.themeId, label: t('desktop.unavailableTheme') });
		return options;
	});
	const current = ref('');
	const next = ref('');
	const changing = ref(false);
	let disposed = false;
	watch([motionEnabled, () => minimized], ([enabled, hidden]) => {
		if (!enabled || hidden) previewSpeed.value = undefined;
	});
	onScopeDispose(() => {
		disposed = true;
		previewSpeed.value = undefined;
	});

	function previewAnimationSpeed(value: number): void {
		if (motionEnabled.value && !minimized) previewSpeed.value = value;
	}

	function saveAnimationSpeed(animationSpeed: number): void {
		if (motionEnabled.value && !minimized && animationSpeed !== state.value.animationSpeed)
			preferences.update({ animationSpeed });
		previewSpeed.value = undefined;
	}

	async function selectTheme(value: string | undefined): Promise<void> {
		if (!value) return;
		try {
			await themeApi.selectTheme(value === 'builtin' ? '' : value);
		} catch {
			log.report({ source: 'settings', level: 'error', code: 'UI_THEME_SELECT_FAILED', userVisible: true });
		}
	}

	async function changePassword(): Promise<void> {
		if (changing.value || !current.value || !next.value) return;
		changing.value = true;
		try {
			await auth.changePassword({ currentPassword: current.value, newPassword: next.value });
			log.report({ source: 'settings', level: 'info', code: 'SETTINGS_PASSWORD_CHANGED', userVisible: true });
		} catch (cause) {
			auth.reportFailure(cause);
		} finally {
			if (!disposed) {
				current.value = next.value = '';
				changing.value = false;
			}
		}
	}
</script>

<template>
	<div class="settings-app">
		<header class="app-page-heading">
			<h1>{{ t('settings') }}</h1>
			<p>{{ t('desktop.settingsHint') }}</p>
		</header>
		<UiSection
			class="settings-section"
			:title="t('desktop.appearance.title')"
			:description="t('desktop.appearanceHint')"
			:icon="Palette"
		>
			<UiSelect
				:model-value="state.themeId || 'builtin'"
				:options="themeOptions"
				:aria-label="t('desktop.themeSource')"
				@update:model-value="selectTheme"
			/>
			<div class="theme-options">
				<button
					v-for="{ value, icon } in themes"
					:key="value"
					class="theme-option"
					type="button"
					:aria-pressed="state.theme === value"
					:data-theme-option="value"
					@click="preferences.update({ theme: value })"
				>
					<span class="theme-sample" :class="'theme-sample--' + value" aria-hidden="true"
						><span /><span
					/></span>
					<span class="theme-option__label"
						><component :is="icon" :size="15" />{{ t('desktop.appearance.' + value) }}</span
					>
				</button>
			</div>
		</UiSection>
		<UiSection class="settings-section" :title="t('desktop.animationTitle')" :icon="Sparkles">
			<UiFormRow
				:label="t('desktop.motionEffects')"
				:description="
					t(reducedMotion === 'reduce' ? 'desktop.systemReducedMotion' : 'desktop.motionEffectsHint')
				"
				v-slot="field"
			>
				<UiSwitch
					:id="field.id"
					:aria-describedby="field.describedby"
					:model-value="state.motionEffects"
					@update:model-value="(motionEffects) => preferences.update({ motionEffects })"
				/>
			</UiFormRow>
			<div class="animation-speed" :class="{ 'is-disabled': !motionEnabled }">
				<div class="animation-speed__heading">
					<span :id="speedLabel">{{ t('desktop.animationSpeed') }}</span>
					<output>{{ n(previewSpeed ?? state.animationSpeed) }}×</output>
				</div>
				<UiSlider
					:model-value="previewSpeed ?? state.animationSpeed"
					:min="AnimationSpeedSchema.minValue!"
					:max="AnimationSpeedSchema.maxValue!"
					:step="0.1"
					:disabled="!motionEnabled"
					:aria-labelledby="speedLabel"
					:aria-valuetext="
						t('desktop.animationSpeedValue', { speed: n(previewSpeed ?? state.animationSpeed) })
					"
					@update:model-value="previewAnimationSpeed"
					@cancel="previewSpeed = undefined"
					@commit="saveAnimationSpeed"
				/>
				<div class="animation-speed__scale" aria-hidden="true">
					<span>{{ t('desktop.animationSlower') }}</span><span>{{ t('desktop.animationFaster') }}</span>
				</div>
			</div>
		</UiSection>
		<UiSection class="settings-section">
			<UiFormRow
				:label="t('desktop.escapeAction')"
				:description="t('desktop.escapeActionHint')"
				:icon="Keyboard"
				v-slot="field"
			>
				<UiSelect
					:id="field.id"
					:aria-describedby="field.describedby"
					:model-value="state.escapeAction"
					:aria-label="t('desktop.escapeAction')"
					:options="[
						{ value: 'minimize', label: t('desktop.minimize') },
						{ value: 'close', label: t('closeApplication') },
					]"
					@update:model-value="
						(escapeAction) =>
							(escapeAction === 'close' || escapeAction === 'minimize') &&
							preferences.update({ escapeAction })
					"
				/>
			</UiFormRow>
		</UiSection>
		<UiSection class="settings-section">
			<UiFormRow :label="t('language')" :description="t('desktop.languageHint')" :icon="Globe" v-slot="field">
				<UiSelect
					:id="field.id"
					:aria-describedby="field.describedby"
					:model-value="state.locale"
					:options="languages"
					:aria-label="t('language')"
					@update:model-value="
						(locale) => (locale === 'zh' || locale === 'en') && preferences.update({ locale })
					"
				/>
			</UiFormRow>
		</UiSection>
		<UiSection class="settings-section" :title="t('desktop.account')" :icon="ShieldCheck">
			<div class="account-identity">
				<span class="account-avatar" aria-hidden="true"><UserRound :size="22" /></span>
				<div class="account-name">
					<span>{{ t('auth.username') }}</span>
					<strong data-ui-selection="text">{{ auth.state.value?.account?.username }}</strong>
				</div>
				<UiButton
					tone="danger"
					:loading="signingOut"
					:disabled="changing"
					loading-animation="spinner"
					@click="emit('logout')"
				>
					<template #leading><LogOut :size="16" /></template>
					{{ t('auth.logout') }}
				</UiButton>
			</div>
			<form
				class="account-password"
				:aria-label="t('desktop.changePassword')"
				:aria-busy="changing"
				@submit.prevent="changePassword"
			>
				<p>{{ t('desktop.passwordHint') }}</p>
				<input
					class="account-autofill"
					type="text"
					name="username"
					autocomplete="username"
					:value="auth.state.value?.account?.username"
					readonly
					tabindex="-1"
					aria-hidden="true"
				/>
				<div class="account-fields">
					<UiField :label="t('desktop.currentPassword')" v-slot="field">
						<UiInput
							:id="field.id"
							v-model="current"
							type="password"
							name="current-password"
							autocomplete="current-password"
							:disabled="changing || signingOut"
							required
						/>
					</UiField>
					<UiField :label="t('desktop.newPassword')" v-slot="field">
						<UiInput
							:id="field.id"
							v-model="next"
							type="password"
							name="new-password"
							autocomplete="new-password"
							:disabled="changing || signingOut"
							required
						/>
					</UiField>
					<UiButton
						class="account-save"
						type="submit"
						tone="primary"
						:loading="changing"
						:disabled="signingOut || !current || !next"
						loading-animation="spinner"
					>
						<template #leading><KeyRound :size="16" /></template>
						{{ t('desktop.changePassword') }}
					</UiButton>
				</div>
			</form>
		</UiSection>
	</div>
</template>

<style scoped>
	.app-page-heading h1 {
		margin: 14px 0 9px;
		font-size: 25px;
		font-weight: 600;
		letter-spacing: -0.7px;
	}
	.app-page-heading p {
		margin: 0;
		color: var(--ui-muted);
		font-size: 12px;
		line-height: 1.8;
	}

	.settings-app {
		container-type: inline-size;
		max-width: 820px;
		padding: clamp(20px, 4vw, 32px);
		margin: auto;
	}
	.settings-section {
		margin-top: 28px;
		padding-bottom: 26px;
		border-bottom: 1px solid var(--ui-border);
	}
	.settings-section:last-of-type {
		border: 0;
	}
	p {
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.8;
	}
	.theme-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		margin-top: 20px;
	}
	.theme-option {
		padding: 9px;
		border: 1px solid var(--ui-border);
		border-radius: 13px;
		background: var(--ui-background);
		color: var(--ui-text);
		cursor: pointer;
	}
	.theme-option[aria-pressed='true'] {
		border-color: var(--ui-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 12%, transparent);
	}
	.theme-sample {
		height: 70px;
		border-radius: 7px;
		padding: 10px;
		display: flex;
		align-items: stretch;
		gap: 6px;
		background: #eae7f5;
	}
	.theme-sample span:first-child {
		width: 22%;
		border-radius: 3px;
		background: #cdc5e5;
	}
	.theme-sample span:last-child {
		flex: 1;
		border-radius: 3px;
		background: #fcfbff;
	}
	.theme-sample--dark {
		background: #242234;
	}
	.theme-sample--dark span:first-child {
		background: #49415f;
	}
	.theme-sample--dark span:last-child {
		background: #363244;
	}
	.theme-sample--system {
		background: linear-gradient(90deg, #eae7f5 50%, #242234 50%);
	}
	.theme-option__label {
		display: flex;
		justify-content: center;
		gap: 7px;
		align-items: center;
		padding: 12px 0 3px;
		font-size: 12px;
	}
	.animation-speed {
		margin-top: 22px;
	}
	.animation-speed.is-disabled {
		opacity: 0.5;
	}
	.animation-speed__heading,
	.animation-speed__scale {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.animation-speed__heading {
		color: var(--ui-text);
		font-size: 13px;
		font-weight: 500;
	}
	.animation-speed__heading output {
		color: var(--ui-primary);
		font-variant-numeric: tabular-nums;
	}
	.animation-speed__scale {
		color: var(--ui-muted);
		font-size: 11px;
	}

	.account-identity {
		margin-top: 18px;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.account-avatar {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		flex: none;
		border-radius: 14px;
		color: var(--ui-primary);
		background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-surface));
	}
	.account-name {
		display: grid;
		gap: 4px;
		flex: 1;
		min-width: 0;
	}
	.account-name span {
		color: var(--ui-muted);
		font-size: 12px;
	}
	.account-name strong {
		font-size: 14px;
		overflow-wrap: anywhere;
	}
	.account-password {
		margin-top: 22px;
		display: grid;
		gap: 16px;
		position: relative;
	}
	.account-password p {
		margin: 0;
		font-size: 12px;
		line-height: 1.8;
		color: var(--ui-muted);
	}
	.account-fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
		align-items: end;
		gap: 14px;
	}
	.account-save {
		justify-self: end;
	}
	.account-autofill {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	@container (max-width: 420px) {
		.account-fields {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
		.account-save {
			grid-column: 1 / -1;
		}
		.theme-options {
			gap: 8px;
		}
		.theme-sample {
			height: 55px;
			padding: 7px;
		}
	}
</style>
