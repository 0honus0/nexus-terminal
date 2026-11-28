<script setup lang="ts">
	import {
		Globe,
		Image,
		Keyboard,
		KeyRound,
		LogOut,
		Monitor,
		Moon,
		Palette,
		ShieldCheck,
		SlidersHorizontal,
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
	import { AnimationSpeedSchema, WindowTitlebarSizeSchema, type DesktopWallpaper } from '../settings-types.js';
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
	const passwordHint = useId();
	const languages = [
		{ value: 'en', label: 'English' },
		{ value: 'zh', label: '简体中文' },
	];
	const themes = [
		{ value: 'light', icon: Sun },
		{ value: 'dark', icon: Moon },
		{ value: 'system', icon: Monitor },
	] as const;
	const wallpapers: readonly DesktopWallpaper[] = ['silk', 'grid', 'dunes', 'minimal'];
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
		<UiSection class="settings-card" :title="t('desktop.appearance.title')" :icon="Palette">
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
						><component :is="icon" :size="14" />{{ t('desktop.appearance.' + value) }}</span
					>
				</button>
			</div>
			<div class="wallpaper-group">
				<div class="wallpaper-group__heading">
					<Image :size="14" aria-hidden="true" />
					<span>{{ t('desktop.appearance.wallpaper') }}</span>
				</div>
				<div class="wallpaper-options">
					<button
						v-for="preset in wallpapers"
						:key="preset"
						class="wallpaper-option"
						type="button"
						:aria-pressed="state.wallpaper === preset"
						:data-wallpaper-option="preset"
						@click="preferences.update({ wallpaper: preset })"
					>
						<span class="wallpaper-sample" :class="'wallpaper-sample--' + preset" aria-hidden="true" />
						<span class="wallpaper-option__label">{{ t('desktop.appearance.wallpapers.' + preset) }}</span>
					</button>
				</div>
			</div>
		</UiSection>

		<UiSection class="settings-card" :title="t('desktop.animationTitle')" :icon="Sparkles">
			<UiFormRow
				:label="t('desktop.motionEffects')"
				:description="reducedMotion === 'reduce' ? t('desktop.systemReducedMotion') : undefined"
				v-slot="field"
			>
				<UiSwitch
					:id="field.id"
					:aria-describedby="field.describedby"
					:aria-label="t('desktop.motionEffects')"
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

		<UiSection class="settings-card" :title="t('desktop.general')" :icon="SlidersHorizontal">
			<div class="settings-rows">
				<UiFormRow
					class="settings-compact-control"
					:label="t('desktop.windowTitlebarSize')"
					:icon="Monitor"
					v-slot="field"
				>
					<UiSelect
						:id="field.id"
						:aria-describedby="field.describedby"
						:aria-label="t('desktop.windowTitlebarSize')"
						:model-value="state.windowTitlebarSize"
						:options="
							WindowTitlebarSizeSchema.options.map((value) => ({
								value,
								label: t('desktop.windowTitlebarSizes.' + value),
							}))
						"
						@update:model-value="
							(value) => {
								const size = WindowTitlebarSizeSchema.safeParse(value);
								if (size.success) preferences.update({ windowTitlebarSize: size.data });
							}
						"
					/>
				</UiFormRow>
				<div class="settings-row-divider" aria-hidden="true" />
				<UiFormRow
					class="settings-compact-control"
					:label="t('desktop.escapeAction')"
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
				<div class="settings-row-divider" aria-hidden="true" />
				<UiFormRow class="settings-compact-control" :label="t('language')" :icon="Globe" v-slot="field">
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
			</div>
		</UiSection>

		<UiSection class="settings-card" :title="t('desktop.account')" :icon="ShieldCheck">
			<div class="account-identity">
				<span class="account-avatar" aria-hidden="true"><UserRound :size="20" /></span>
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
					<template #leading><LogOut :size="15" /></template>
					{{ t('auth.logout') }}
				</UiButton>
			</div>
			<form
				class="account-password"
				:aria-label="t('desktop.changePassword')"
				:aria-describedby="passwordHint"
				:aria-busy="changing"
				@submit.prevent="changePassword"
			>
				<input
					class="account-autofill"
					type="text"
					name="username"
					autocomplete="username"
					:aria-label="t('auth.username')"
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
				</div>
				<div class="account-password-actions">
					<p :id="passwordHint">{{ t('desktop.passwordHint') }}</p>
					<UiButton
						class="account-save"
						type="submit"
						tone="primary"
						:loading="changing"
						:disabled="signingOut || !current || !next"
						loading-animation="spinner"
					>
						<template #leading><KeyRound :size="15" /></template>
						{{ t('desktop.savePassword') }}
					</UiButton>
				</div>
			</form>
		</UiSection>
	</div>
</template>

<style scoped>
	.settings-app {
		container-type: inline-size;
		max-width: 780px;
		padding: clamp(16px, 3vw, 26px);
		margin: auto;
		display: grid;
		gap: 14px;
	}
	.settings-card {
		--settings-card-inline: 20px;
		--settings-card-bottom: 18px;
		--ui-section-title-size: 17px;
		--ui-section-icon-color: var(--ui-primary);

		padding: 0 var(--settings-card-inline) var(--settings-card-bottom);
		border: 1px solid color-mix(in srgb, var(--ui-border) 78%, transparent);
		border-radius: 16px;
		background: color-mix(in srgb, var(--ui-surface) 92%, transparent);
		box-shadow: 0 2px 10px color-mix(in srgb, #241b35 4%, transparent);
	}
	.settings-card :deep(.ui-section__header) {
		margin-inline: calc(-1 * var(--settings-card-inline));
		padding: 10px var(--settings-card-inline);
		border-block-end: 1px solid var(--ui-border);
		border-radius: 15px 15px 0 0;
		background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-surface));
	}
	.settings-card :deep(.ui-section__heading h2) {
		font-weight: 680;
	}
	.settings-card :deep(.ui-section__heading h2 > svg) {
		box-sizing: content-box;
		padding: 6px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
	}
	.settings-rows {
		display: grid;
		gap: 12px;
	}
	.settings-row-divider {
		height: 1px;
		background: color-mix(in srgb, var(--ui-border) 55%, transparent);
	}
	.settings-compact-control {
		--ui-form-control-width: 150px;
		--ui-control-gap: 6px;
	}
	p {
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.7;
	}
	.theme-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		margin-top: 14px;
	}
	.theme-option {
		padding: 8px;
		border: 1px solid color-mix(in srgb, var(--ui-border) 82%, transparent);
		border-radius: 13px;
		background: var(--ui-background);
		color: var(--ui-text);
		cursor: pointer;
		transition:
			border-color var(--ui-motion-duration, 140ms) ease,
			box-shadow var(--ui-motion-duration, 140ms) ease;
	}
	.theme-option:hover {
		border-color: color-mix(in srgb, var(--ui-primary) 45%, var(--ui-border));
	}
	.theme-option[aria-pressed='true'] {
		border-color: var(--ui-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 16%, transparent);
	}
	.theme-sample {
		height: 62px;
		border-radius: 8px;
		padding: 9px;
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
		gap: 6px;
		align-items: center;
		padding: 9px 0 2px;
		font-size: 12px;
		font-weight: 500;
	}
	.wallpaper-group {
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px solid color-mix(in srgb, var(--ui-border) 55%, transparent);
		display: grid;
		gap: 10px;
	}
	.wallpaper-group__heading {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		font-weight: 550;
		color: var(--ui-muted);
	}
	.wallpaper-options {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}
	.wallpaper-option {
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 6px;
		border: 1px solid color-mix(in srgb, var(--ui-border) 82%, transparent);
		border-radius: 12px;
		background: var(--ui-background);
		color: var(--ui-text);
		cursor: pointer;
		transition:
			border-color var(--ui-motion-duration, 140ms) ease,
			box-shadow var(--ui-motion-duration, 140ms) ease;
	}
	.wallpaper-option:hover {
		border-color: color-mix(in srgb, var(--ui-primary) 45%, var(--ui-border));
	}
	.wallpaper-option[aria-pressed='true'] {
		border-color: var(--ui-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 16%, transparent);
	}
	.wallpaper-sample {
		display: block;
		width: 100%;
		height: 44px;
		border-radius: 7px;
		border: 1px solid color-mix(in srgb, var(--ui-border) 45%, transparent);
	}
	.wallpaper-sample--silk {
		background: var(--ui-wallpaper-silk);
	}
	.wallpaper-sample--grid {
		background: var(--ui-wallpaper-grid);
		background-size:
			10px 10px,
			cover,
			cover,
			cover;
	}
	.wallpaper-sample--dunes {
		background: var(--ui-wallpaper-dunes);
		background-size: cover;
	}
	.wallpaper-sample--minimal {
		background: var(--ui-wallpaper-minimal);
	}
	.wallpaper-option__label {
		font-size: 11.5px;
		font-weight: 500;
		text-align: center;
		line-height: 1.25;
		padding-bottom: 1px;
	}
	.animation-speed {
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px solid color-mix(in srgb, var(--ui-border) 55%, transparent);
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
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.animation-speed__scale {
		color: var(--ui-muted);
		font-size: 11px;
	}
	.account-identity {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.account-avatar {
		display: grid;
		place-items: center;
		width: 42px;
		height: 42px;
		flex: none;
		border-radius: 13px;
		color: var(--ui-primary);
		background: color-mix(in srgb, var(--ui-primary) 11%, var(--ui-surface));
	}
	.account-name {
		display: grid;
		gap: 3px;
		flex: 1;
		min-width: 0;
	}
	.account-name span {
		color: var(--ui-muted);
		font-size: 11.5px;
	}
	.account-name strong {
		font-size: 14px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.account-password {
		margin-top: 14px;
		padding-top: 16px;
		border-top: 1px solid color-mix(in srgb, var(--ui-border) 55%, transparent);
		display: grid;
		gap: 14px;
		position: relative;
	}
	.account-password p {
		margin: 0;
		font-size: 12px;
		line-height: 1.65;
		color: var(--ui-muted);
	}
	.account-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.account-password-actions {
		display: flex;
		align-items: center;
		gap: 12px 16px;
	}
	.account-password-actions p {
		flex: 1;
	}
	.account-save {
		flex: none;
	}
	.account-autofill {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	@container (max-width: 460px) {
		.settings-card {
			--settings-card-inline: 15px;
			--settings-card-bottom: 14px;
		}
		.account-fields {
			grid-template-columns: minmax(0, 1fr);
		}
		.account-password-actions {
			display: grid;
		}
		.theme-options {
			gap: 8px;
		}
		.theme-sample {
			height: 52px;
			padding: 7px;
		}
		.wallpaper-options {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
