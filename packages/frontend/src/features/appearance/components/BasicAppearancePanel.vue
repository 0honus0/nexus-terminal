<script setup lang="ts">
	import { computed, onMounted, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInput, UiTextarea } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import { darkUiTheme, defaultUiTheme, defaultWindowThemeColor, normalizeUiTheme } from '../config/default-theme';
	import { useAppearanceStore } from '../store/appearance.store';
	import { formatThemeObject, parseThemeObject } from '../model/themeEditor';

	type AppearanceSection = 'all' | 'ui' | 'terminal' | 'other';
	const props = withDefaults(defineProps<{ section?: AppearanceSection; showUiActions?: boolean }>(), {
		section: 'all',
		showUiActions: true,
	});

	const { t } = useI18n();
	const feedback = useFeedback();
	const store = useAppearanceStore();
	const form = reactive({
		terminalFontFamily: '',
		terminalFontSize: 14,
		terminalFontSizeMobile: 14,
		editorFontFamily: '',
		editorFontSize: 14,
		mobileEditorFontSize: 16,
		windowThemeColor: defaultWindowThemeColor,
	});
	const uiTheme = reactive<Record<string, string>>({ ...defaultUiTheme });
	const uiThemeJson = ref(formatThemeObject(uiTheme));
	const uiThemeParseError = ref('');
	const rawThemeEditing = ref(false);

	const showWindow = computed(() => props.section === 'all');
	const showTerminal = computed(() => props.section === 'all' || props.section === 'terminal');
	const showEditor = computed(() => props.section === 'all' || props.section === 'other');
	const showUi = computed(() => props.section === 'all' || props.section === 'ui');

	const sync = (): void => {
		Object.assign(form, {
			terminalFontFamily: store.settings.terminalFontFamily ?? '',
			terminalFontSize: store.settings.terminalFontSize ?? 14,
			terminalFontSizeMobile: store.settings.terminalFontSizeMobile ?? 14,
			editorFontFamily: store.settings.editorFontFamily ?? '',
			editorFontSize: store.settings.editorFontSize ?? 14,
			mobileEditorFontSize: store.settings.mobileEditorFontSize ?? 16,
			windowThemeColor: store.settings.windowThemeColor ?? defaultWindowThemeColor,
		});

		try {
			Object.assign(uiTheme, normalizeUiTheme(JSON.parse(store.settings.customUiTheme ?? '{}')));
		} catch {
			Object.assign(uiTheme, defaultUiTheme);
		}
		uiThemeJson.value = formatThemeObject(uiTheme);
		uiThemeParseError.value = '';
	};

	watch(() => store.settings, sync, { deep: true });
	watch(
		uiTheme,
		() => {
			if (!rawThemeEditing.value) uiThemeJson.value = formatThemeObject(uiTheme);
		},
		{ deep: true },
	);
	onMounted(sync);

	const savePatch = async (patch: Record<string, unknown>): Promise<void> => {
		try {
			await store.update(patch);
			feedback.notifySuccess(t('common.saved'));
		} catch (cause) {
			feedback.notifyError(cause instanceof Error ? cause.message : t('common.errorOccurred'));
		}
	};

	const saveWindow = (): Promise<void> => savePatch({ windowThemeColor: form.windowThemeColor });

	const saveTerminal = (): Promise<void> =>
		savePatch({
			terminalFontFamily: form.terminalFontFamily,
			terminalFontSize: form.terminalFontSize,
			terminalFontSizeMobile: form.terminalFontSizeMobile,
		});

	const saveEditor = (): Promise<void> =>
		savePatch({
			editorFontFamily: form.editorFontFamily,
			editorFontSize: form.editorFontSize,
			mobileEditorFontSize: form.mobileEditorFontSize,
		});

	const saveGeneral = (): Promise<void> => savePatch({ ...form });

	const applyUiThemeJson = (): boolean => {
		const parsed = parseThemeObject(uiThemeJson.value);
		if (!parsed.value) {
			uiThemeParseError.value = t(
				parsed.error === 'object-required' || parsed.error === 'string-values-required'
					? 'styleCustomizer.errorInvalidJsonObject'
					: 'styleCustomizer.uiThemeParseError',
				{ message: parsed.error ?? '' },
			);
			return false;
		}
		for (const key of Object.keys(uiTheme)) delete uiTheme[key];
		Object.assign(uiTheme, normalizeUiTheme(parsed.value));
		uiThemeParseError.value = '';
		uiThemeJson.value = formatThemeObject(uiTheme);
		return true;
	};

	const saveUiTheme = async (): Promise<void> => {
		if (rawThemeEditing.value && !applyUiThemeJson()) return;
		try {
			await store.saveUiTheme({ ...uiTheme });
			feedback.notifySuccess(t('common.saved'));
		} catch (cause) {
			feedback.notifyError(t('styleCustomizer.uiThemeSaveFailed', { message: String(cause) }));
		}
	};

	const resetUiTheme = async (): Promise<void> => {
		Object.assign(uiTheme, defaultUiTheme);
		try {
			await store.saveUiTheme({ ...defaultUiTheme });
			feedback.notifySuccess(t('styleCustomizer.uiThemeReset'));
		} catch (cause) {
			feedback.notifyError(t('styleCustomizer.uiThemeResetFailed', { message: String(cause) }));
		}
	};

	const applyDarkMode = async (): Promise<void> => {
		Object.assign(uiTheme, darkUiTheme);
		try {
			await store.saveUiTheme({ ...darkUiTheme });
			feedback.notifySuccess(t('styleCustomizer.darkModeApplied'));
		} catch (cause) {
			feedback.notifyError(t('styleCustomizer.darkModeApplyFailed', { message: String(cause) }));
		}
	};

	const resetWindowColor = (): void => {
		form.windowThemeColor = defaultWindowThemeColor;
	};

	const formatLabel = (key: string): string =>
		key
			.replace(/^--/, '')
			.replace(/-/g, ' ')
			.replace(/([A-Z])/g, ' $1')
			.replace(/^./, (value) => value.toUpperCase());

	const isColorValue = (value: string): boolean =>
		value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl');

	const selectInputText = (event: FocusEvent): void => {
		const target = event.target;
		if (target instanceof HTMLInputElement) target.select();
	};

	defineExpose({ saveUiTheme, resetUiTheme });
</script>

<template>
	<section class="space-y-6">
		<section v-if="showWindow" class="space-y-4">
			<div class="grid gap-4 md:grid-cols-2">
				<UiFormField :label="t('settings.appearance.windowThemeColor.label')">
					<div class="flex gap-2">
						<UiInput
							v-model="form.windowThemeColor"
							type="color"
							class="shrink-0"
							style="width: 3.5rem"
							:aria-label="t('settings.appearance.windowThemeColor.label')"
						/>
						<UiInput v-model="form.windowThemeColor" />
					</div>
				</UiFormField>
				<div class="flex items-end gap-2">
					<UiButton appearance="solid" tone="primary" @click="saveWindow">{{ t('common.save') }}</UiButton>
					<UiButton @click="resetWindowColor">{{ t('common.restore') }}</UiButton>
				</div>
			</div>
		</section>

		<section v-if="showTerminal" class="space-y-4">
			<h3
				v-if="props.section === 'terminal'"
				class="mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground"
			>
				{{ t('styleCustomizer.terminalStyles') }}
			</h3>
			<div class="grid gap-4 md:grid-cols-3">
				<UiFormField :label="t('styleCustomizer.terminalFontFamily')">
					<UiInput v-model="form.terminalFontFamily" />
				</UiFormField>
				<UiFormField :label="t('styleCustomizer.terminalFontSize')">
					<UiInput v-model="form.terminalFontSize" type="number" />
				</UiFormField>
				<UiFormField :label="t('styleCustomizer.terminalFontSizeMobile')">
					<UiInput v-model="form.terminalFontSizeMobile" type="number" />
				</UiFormField>
			</div>
			<UiButton v-if="props.section !== 'all'" @click="saveTerminal">{{ t('common.save') }}</UiButton>
		</section>

		<section v-if="showEditor" class="space-y-4">
			<h3
				v-if="props.section === 'other'"
				class="mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground"
			>
				{{ t('styleCustomizer.otherSettings') }}
			</h3>
			<div class="grid gap-4 md:grid-cols-3">
				<UiFormField :label="t('styleCustomizer.editorFontFamily')">
					<UiInput v-model="form.editorFontFamily" />
				</UiFormField>
				<UiFormField :label="t('styleCustomizer.editorFontSize')">
					<UiInput v-model="form.editorFontSize" type="number" />
				</UiFormField>
				<UiFormField :label="t('styleCustomizer.editorFontSizeMobile')">
					<UiInput v-model="form.mobileEditorFontSize" type="number" />
				</UiFormField>
			</div>
			<UiButton v-if="props.section !== 'all'" @click="saveEditor">{{ t('common.save') }}</UiButton>
		</section>

		<UiButton v-if="props.section === 'all'" appearance="solid" tone="primary" @click="saveGeneral">{{
			t('common.save')
		}}</UiButton>

		<section v-if="showUi">
			<h3
				v-if="props.section === 'ui'"
				class="mb-4 mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground"
			>
				{{ t('styleCustomizer.uiStyles') }}
			</h3>
			<div class="mb-6 grid grid-cols-1 items-start gap-2 md:grid-cols-[auto_1fr] md:items-center md:gap-3">
				<span class="mb-1 text-left text-sm font-medium text-foreground md:mb-0">{{
					t('styleCustomizer.themeModeLabel')
				}}</span>
				<div class="flex flex-wrap justify-start gap-2">
					<UiButton density="compact" @click="resetUiTheme">{{ t('styleCustomizer.defaultMode') }}</UiButton>
					<UiButton density="compact" @click="applyDarkMode">{{ t('styleCustomizer.darkMode') }}</UiButton>
				</div>
			</div>
			<p class="mb-3 text-sm leading-relaxed text-text-secondary">{{ t('styleCustomizer.uiDescription') }}</p>

			<div class="grid min-w-0 gap-3 sm:grid-cols-2">
				<UiFormField v-for="(value, key) in uiTheme" :key="key" :label="formatLabel(String(key))">
					<div class="flex min-w-0 items-center gap-2">
						<UiInput
							v-if="isColorValue(value)"
							v-model="uiTheme[key]"
							type="color"
							class="shrink-0"
							style="width: 3rem"
							:aria-label="formatLabel(String(key))"
						/>
						<UiInput
							:id="`ui-${key}`"
							v-model="uiTheme[key]"
							class="min-w-0 flex-1"
							@focus="selectInputText"
						/>
					</div>
				</UiFormField>
			</div>

			<hr class="my-8 border-border" />
			<h4 class="mb-2 mt-6 text-base font-semibold text-foreground">
				{{ t('styleCustomizer.uiThemeJsonEditorTitle') }}
			</h4>
			<p class="mb-3 text-sm leading-relaxed text-text-secondary">
				{{ t('styleCustomizer.uiThemeJsonEditorDesc') }}
			</p>
			<div class="mt-4">
				<UiTextarea
					v-model="uiThemeJson"
					class="min-h-[200px] resize-y whitespace-pre-wrap break-words p-3 font-mono text-sm leading-snug"
					:min-rows="15"
					spellcheck="false"
					@focus="rawThemeEditing = true"
					@blur="
						rawThemeEditing = false;
						applyUiThemeJson();
					"
				/>
				<p
					v-if="uiThemeParseError"
					class="mt-2 rounded border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
				>
					{{ uiThemeParseError }}
				</p>
			</div>
			<div v-if="props.showUiActions" class="mt-4 flex gap-2">
				<UiButton appearance="solid" tone="primary" @click="saveUiTheme">{{ t('common.save') }}</UiButton>
				<UiButton @click="resetUiTheme">{{ t('common.restore') }}</UiButton>
			</div>
		</section>
	</section>
</template>
