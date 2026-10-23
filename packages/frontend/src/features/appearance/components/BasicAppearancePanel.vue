<script setup lang="ts">
	import { computed, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInlineNotice, UiInput, UiNumberInput, UiTextarea } from '@/foundation/ui';
	import { darkUiTheme, defaultUiTheme, defaultWindowThemeColor, normalizeUiTheme } from '../config/default-theme';
	import { useAppearanceStore } from '../store/appearance.store';
	import { formatThemeObject } from '../model/theme-editor';
	import { readAppearanceUiTheme } from '@nexus-terminal/shared/preferences/appearance/http-codec';
	import type { AppearancePatch } from '../model/appearance-types';
	import { useAppearanceEditor } from '../composables/use-appearance-editor';
	type AppearanceSection = 'all' | 'ui' | 'terminal' | 'other';
	const props = withDefaults(defineProps<{ section?: AppearanceSection; showUiActions?: boolean }>(), {
		section: 'all',
		showUiActions: true,
	});
	const { t } = useI18n();
	const store = useAppearanceStore();
	const editor = useAppearanceEditor();
	const form = reactive({
		terminalFontFamily: '',
		terminalFontSize: 14,
		terminalFontSizeMobile: 14,
		editorFontFamily: '',
		editorFontSize: 14,
		mobileEditorFontSize: 16,
		windowThemeColor: defaultWindowThemeColor,
	});
	const uiTheme = reactive<Record<string, string>>({});
	const uiThemeJson = ref('{}');
	const uiThemeParseError = ref('');
	const rawThemeEditing = ref(false);
	const dirty = ref(false);
	let baseline: number | null = null;
	let syncing = false;
	const showWindow = computed(() => props.section === 'all');
	const showTerminal = computed(() => props.section === 'all' || props.section === 'terminal');
	const showEditor = computed(() => props.section === 'all' || props.section === 'other');
	const showUi = computed(() => props.section === 'all' || props.section === 'ui');

	function sync(): void {
		const value = store.snapshot;
		if (!value) {
			return;
		}
		syncing = true;
		form.terminalFontFamily = value.terminalFontFamily;
		form.terminalFontSize = value.terminalFontSize;
		form.terminalFontSizeMobile = value.terminalFontSizeMobile;
		form.editorFontFamily = value.editorFontFamily ?? '';
		form.editorFontSize = value.editorFontSize;
		form.mobileEditorFontSize = value.mobileEditorFontSize;
		form.windowThemeColor = value.windowThemeColor;
		for (const key of Object.keys(uiTheme)) {
			delete uiTheme[key];
		}
		Object.assign(uiTheme, normalizeUiTheme(readAppearanceUiTheme(value.customUiTheme)));
		uiThemeJson.value = formatThemeObject(uiTheme);
		uiThemeParseError.value = '';
		baseline = value.version;
		syncing = false;
		dirty.value = false;
	}

	watch(
		() => store.snapshot,
		() => {
			if (!dirty.value) {
				sync();
			}
		},
		{ immediate: true },
	);
	watch(
		[form, uiTheme, uiThemeJson],
		() => {
			if (!syncing) {
				dirty.value = true;
			}
		},
		{ deep: true, flush: 'sync' },
	);
	watch(
		uiTheme,
		() => {
			if (!rawThemeEditing.value) {
				uiThemeJson.value = formatThemeObject(uiTheme);
			}
		},
		{ deep: true },
	);

	async function savePatch(patch: AppearancePatch): Promise<void> {
		const version = baseline;
		if (version === null) {
			return;
		}
		if (await editor.run((signal) => store.update(patch, version, signal))) {
			sync();
		}
	}

	const saveWindow = (): Promise<void> => savePatch({ windowThemeColor: form.windowThemeColor });

	const saveTerminal = (): Promise<void> =>
		savePatch({
			terminalFontFamily: form.terminalFontFamily,
			terminalFontSize: form.terminalFontSize,
			terminalFontSizeMobile: form.terminalFontSizeMobile,
		});

	const saveEditor = (): Promise<void> =>
		savePatch({
			editorFontFamily: form.editorFontFamily || null,
			editorFontSize: form.editorFontSize,
			mobileEditorFontSize: form.mobileEditorFontSize,
		});

	const saveGeneral = (): Promise<void> =>
		savePatch({
			terminalFontFamily: form.terminalFontFamily,
			terminalFontSize: form.terminalFontSize,
			terminalFontSizeMobile: form.terminalFontSizeMobile,
			editorFontFamily: form.editorFontFamily || null,
			editorFontSize: form.editorFontSize,
			mobileEditorFontSize: form.mobileEditorFontSize,
			windowThemeColor: form.windowThemeColor,
		});

	function applyUiThemeJson(): boolean {
		try {
			const value = readAppearanceUiTheme(uiThemeJson.value);
			for (const key of Object.keys(uiTheme)) {
				delete uiTheme[key];
			}
			Object.assign(uiTheme, value);
			uiThemeParseError.value = '';
			return true;
		} catch {
			uiThemeParseError.value = t('appearanceNext.invalid');
			return false;
		}
	}

	async function saveUiTheme(): Promise<void> {
		if (applyUiThemeJson()) {
			await savePatch({ customUiTheme: JSON.stringify(uiTheme) });
		}
	}

	async function resetUiTheme(): Promise<void> {
		await savePatch({ customUiTheme: JSON.stringify(defaultUiTheme) });
	}

	async function applyDarkMode(): Promise<void> {
		await savePatch({ customUiTheme: JSON.stringify(darkUiTheme) });
	}

	function resetWindowColor(): void {
		form.windowThemeColor = defaultWindowThemeColor;
	}

	const formatLabel = (key: string): string => key.replace(/^--/, '').replace(/-/g, ' ');

	const isColorValue = (value: string): boolean =>
		value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl');

	function selectInputText(event: FocusEvent): void {
		if (event.target instanceof HTMLInputElement) {
			event.target.select();
		}
	}

	defineExpose({ saveUiTheme, resetUiTheme });
</script>

<template>
	<fieldset
		class="m-0 min-w-0 border-0 p-0"
		:disabled="store.busy || editor.busy.value || store.blocked || !store.loaded"
	>
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
						<UiButton appearance="solid" tone="primary" @click="saveWindow">{{
							t('common.save')
						}}</UiButton>
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
						<UiNumberInput v-model="form.terminalFontSize" />
					</UiFormField>
					<UiFormField :label="t('styleCustomizer.terminalFontSizeMobile')">
						<UiNumberInput v-model="form.terminalFontSizeMobile" />
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
						<UiNumberInput v-model="form.editorFontSize" />
					</UiFormField>
					<UiFormField :label="t('styleCustomizer.editorFontSizeMobile')">
						<UiNumberInput v-model="form.mobileEditorFontSize" />
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
						<UiButton density="compact" @click="resetUiTheme">{{
							t('styleCustomizer.defaultMode')
						}}</UiButton>
						<UiButton density="compact" @click="applyDarkMode">{{
							t('styleCustomizer.darkMode')
						}}</UiButton>
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
					<UiInlineNotice v-if="uiThemeParseError" class="mt-2" tone="danger" compact>
						{{ uiThemeParseError }}
					</UiInlineNotice>
				</div>
				<div v-if="props.showUiActions" class="mt-4 flex gap-2">
					<UiButton appearance="solid" tone="primary" @click="saveUiTheme">{{ t('common.save') }}</UiButton>
					<UiButton @click="resetUiTheme">{{ t('common.restore') }}</UiButton>
				</div>
			</section>
		</section>
	</fieldset>
</template>
