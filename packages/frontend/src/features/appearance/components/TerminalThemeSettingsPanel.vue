<script setup lang="ts">
	import { computed, onMounted, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInput, UiSelect, UiSurface, UiTextarea } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import { appearanceApi } from '../api/appearanceApi';
	import type { TerminalThemeDto } from '@nexus-terminal/protocol/appearance';
	import { formatThemeObject, parseThemeObject } from '../model/themeEditor';
	import { useAppearanceStore } from '../store/appearance.store';
	import AppearancePresetToolbar from './AppearancePresetToolbar.vue';

	const { t } = useI18n();
	const feedback = useFeedback();
	const store = useAppearanceStore();
	const editorVisible = ref(false);
	const editingTheme = ref<TerminalThemeDto | null>(null);
	const themeName = ref('');
	const themeDraft = reactive<Record<string, string>>({});
	const themeJson = ref('{}');
	const themeParseError = ref('');
	const rawThemeEditing = ref(false);
	const importInput = ref<HTMLInputElement | null>(null);
	const search = ref('');

	onMounted(() => {
		void store.refreshThemes().catch(() => feedback.notifyError(t('styleCustomizer.errorLoadThemeDataFailed')));
	});

	const activeTheme = computed(
		() => store.themes.find((theme) => theme.id === store.settings.activeTerminalThemeId) ?? null,
	);
	const sortedThemes = computed(() => [...store.themes].sort((left, right) => left.name.localeCompare(right.name)));
	const themeOptions = computed(() => [
		{ value: null, label: t('styleCustomizer.defaultTheme') },
		...sortedThemes.value.map((theme) => ({ value: theme.id, label: theme.name })),
	]);

	const selectTheme = (value: string | number | null): void => {
		if (value === null || typeof value === 'number') void applyTheme(value);
	};

	const swatchKeys = ['background', 'foreground', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];
	const filteredThemes = computed(() => {
		const query = search.value.trim().toLowerCase();
		return query
			? sortedThemes.value.filter((theme) => theme.name.toLowerCase().includes(query))
			: sortedThemes.value;
	});
	const themeFields = computed(() => Object.keys(themeDraft).sort((left, right) => left.localeCompare(right)));

	const replaceThemeDraft = (value: Record<string, string>): void => {
		for (const key of Object.keys(themeDraft)) delete themeDraft[key];
		Object.assign(themeDraft, value);
		themeJson.value = formatThemeObject(themeDraft);
		themeParseError.value = '';
	};

	watch(
		themeDraft,
		() => {
			if (!rawThemeEditing.value) themeJson.value = formatThemeObject(themeDraft);
		},
		{ deep: true },
	);

	const applyTheme = async (id: number | null): Promise<void> => {
		try {
			await store.update({ activeTerminalThemeId: id });
			const name = store.themes.find((theme) => theme.id === id)?.name ?? t('styleCustomizer.defaultTheme');
			feedback.notifySuccess(t('styleCustomizer.setActiveThemeSuccess', { themeName: name }));
		} catch (cause) {
			feedback.notifyError(t('styleCustomizer.setActiveThemeFailed', { message: String(cause) }));
		}
	};

	const openCreate = (): void => {
		editingTheme.value = null;
		themeName.value = t('styleCustomizer.newThemeDefaultName');
		replaceThemeDraft({ background: '#000000', foreground: '#ffffff' });
		editorVisible.value = true;
	};

	const openEdit = (theme: TerminalThemeDto): void => {
		editingTheme.value = theme.preset ? null : theme;
		themeName.value = theme.preset ? t('styleCustomizer.themeCopyName', { name: theme.name }) : theme.name;
		replaceThemeDraft(theme.themeData);
		editorVisible.value = true;
	};

	const applyThemeJson = (): boolean => {
		const parsed = parseThemeObject(themeJson.value);
		if (!parsed.value) {
			themeParseError.value =
				parsed.error === 'object-required' || parsed.error === 'string-values-required'
					? t('styleCustomizer.errorInvalidJsonObject')
					: t('styleCustomizer.terminalThemeParseError', { message: parsed.error ?? '' });
			return false;
		}
		replaceThemeDraft(parsed.value);
		return true;
	};

	const finishRawThemeEditing = (): void => {
		rawThemeEditing.value = false;
		window.setTimeout(() => {
			if (!rawThemeEditing.value && editorVisible.value) applyThemeJson();
		}, 0);
	};

	const saveTheme = async (): Promise<void> => {
		if (!themeName.value.trim()) {
			feedback.notifyWarning(t('styleCustomizer.errorThemeNameRequired'));
			return;
		}
		if (!applyThemeJson()) {
			feedback.notifyError(t('styleCustomizer.errorFixJsonBeforeSave'));
			return;
		}

		const themeData = { ...themeDraft };
		try {
			if (editingTheme.value) {
				await appearanceApi.updateTheme(editingTheme.value.id, themeName.value.trim(), themeData);
				feedback.notifySuccess(t('styleCustomizer.themeUpdatedSuccess'));
			} else {
				await appearanceApi.createTheme(themeName.value.trim(), themeData);
				feedback.notifySuccess(t('styleCustomizer.themeCreatedSuccess'));
			}
			editorVisible.value = false;
			await store.refreshThemes();
		} catch (cause) {
			feedback.notifyError(cause instanceof Error ? cause.message : t('styleCustomizer.themeSaveFailed'));
		}
	};

	const removeTheme = async (theme: TerminalThemeDto): Promise<void> => {
		if (theme.preset) {
			feedback.notifyWarning(t('styleCustomizer.cannotDeletePreset'));
			return;
		}
		if (
			!(await feedback.confirm({
				message: t('styleCustomizer.confirmDeleteTheme', { name: theme.name }),
				destructive: true,
			}))
		) {
			return;
		}
		try {
			await appearanceApi.deleteTheme(theme.id);
			if (store.settings.activeTerminalThemeId === theme.id) await store.update({ activeTerminalThemeId: null });
			await store.refreshThemes();
			feedback.notifySuccess(t('styleCustomizer.themeDeletedSuccess'));
		} catch (cause) {
			feedback.notifyError(t('styleCustomizer.themeDeleteFailed', { message: String(cause) }));
		}
	};

	const importTheme = async (event: Event): Promise<void> => {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			await appearanceApi.importTheme(file);
			await store.refreshThemes();
			feedback.notifySuccess(t('styleCustomizer.importSuccess'));
		} catch (cause) {
			feedback.notifyError(`${t('styleCustomizer.importFailed')} ${String(cause)}`);
		} finally {
			input.value = '';
		}
	};

	const exportActive = async (): Promise<void> => {
		if (!activeTheme.value) return;
		const fileName = `${activeTheme.value.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
		try {
			await appearanceApi.exportTheme(activeTheme.value.id, fileName);
		} catch (cause) {
			feedback.notifyError(t('styleCustomizer.exportFailed', { message: String(cause) }));
		}
	};

	const labelForThemeField = (key: string): string =>
		key.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase());
</script>

<template>
	<section class="min-w-0 space-y-4" data-terminal-theme-panel>
		<template v-if="!editorVisible">
			<h4 class="m-0 text-base font-semibold text-foreground">
				{{ t('styleCustomizer.terminalThemeSelection') }}
			</h4>

			<UiSurface surface="inset" class="space-y-3 p-3">
				<UiFormField :label="t('styleCustomizer.activeTheme')">
					<UiSelect
						:model-value="store.settings.activeTerminalThemeId ?? null"
						:options="themeOptions"
						:aria-label="t('styleCustomizer.activeTheme')"
						match-trigger-width
						@update:model-value="selectTheme"
					/>
				</UiFormField>
				<div class="flex flex-wrap items-center gap-2">
					<UiButton density="compact" appearance="solid" tone="primary" @click="openCreate">{{
						t('styleCustomizer.addNewTheme')
					}}</UiButton>
					<UiButton density="compact" @click="importInput?.click()">{{
						t('styleCustomizer.importTheme')
					}}</UiButton>
					<UiButton density="compact" :disabled="!activeTheme" @click="exportActive">{{
						t('styleCustomizer.exportActiveTheme')
					}}</UiButton>
					<input
						ref="importInput"
						class="hidden"
						type="file"
						accept="application/json,.json"
						@change="importTheme"
					/>
				</div>
			</UiSurface>

			<AppearancePresetToolbar v-model="search" :placeholder="t('styleCustomizer.searchThemePlaceholder')" />

			<ul class="m-0 max-h-[320px] list-none space-y-2 overflow-y-auto p-0.5">
				<li v-if="filteredThemes.length === 0" class="p-4 text-center italic text-text-secondary">
					{{ t('styleCustomizer.noThemesFound') }}
				</li>
				<li
					v-for="theme in filteredThemes"
					v-else
					:key="theme.id"
					:class="[
						'min-w-0 rounded-xl border p-3 text-sm transition-colors',
						theme.id === store.settings.activeTerminalThemeId
							? 'border-primary/50 bg-primary/5'
							: 'border-border/60 bg-header/30 hover:bg-header/60',
					]"
				>
					<div class="mb-3 flex min-w-0 items-center gap-2">
						<i
							v-if="theme.id === store.settings.activeTerminalThemeId"
							class="fa-solid fa-circle-check shrink-0 text-primary"
							:title="t('styleCustomizer.activeTheme')"
							aria-hidden="true"
						></i>
						<span class="min-w-0 flex-1 truncate font-medium text-foreground" :title="theme.name">
							{{ theme.name }}
						</span>
					</div>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex shrink-0 gap-1" aria-hidden="true">
							<span
								v-for="key in swatchKeys"
								:key="key"
								class="h-4 w-4 rounded border border-border/50"
								:style="{ backgroundColor: theme.themeData[key] ?? 'transparent' }"
								:title="key"
							></span>
						</div>
						<div class="flex flex-wrap gap-2">
							<UiButton
								density="compact"
								tone="primary"
								:disabled="theme.id === store.settings.activeTerminalThemeId"
								@click="applyTheme(theme.id)"
							>
								{{ t('styleCustomizer.applyButton') }}
							</UiButton>
							<UiButton density="compact" @click="openEdit(theme)">
								{{ theme.preset ? t('styleCustomizer.editAsCopy') : t('common.edit') }}
							</UiButton>
							<UiButton v-if="!theme.preset" density="compact" tone="danger" @click="removeTheme(theme)">
								{{ t('common.delete') }}
							</UiButton>
						</div>
					</div>
				</li>
			</ul>
		</template>

		<section v-else>
			<h3 class="mb-4 mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground">
				{{ editingTheme ? t('styleCustomizer.editThemeTitle') : t('styleCustomizer.newThemeTitle') }}
			</h3>

			<UiFormField :label="t('styleCustomizer.themeName')">
				<UiInput v-model="themeName" />
			</UiFormField>

			<hr class="my-4 border-border md:my-8" />
			<h4 class="mb-2 mt-6 text-base font-semibold text-foreground">
				{{ t('styleCustomizer.terminalThemeColorEditorTitle') }}
			</h4>
			<div class="grid min-w-0 gap-3 sm:grid-cols-2">
				<UiFormField v-for="key in themeFields" :key="key" :label="labelForThemeField(key)">
					<div class="flex min-w-0 items-center gap-2">
						<UiInput
							v-if="themeDraft[key]?.startsWith('#')"
							v-model="themeDraft[key]"
							type="color"
							class="shrink-0"
							style="width: 3rem"
							:aria-label="labelForThemeField(key)"
						/>
						<UiInput v-model="themeDraft[key]" class="min-w-0 flex-1" />
					</div>
				</UiFormField>
			</div>

			<hr class="my-4 border-border md:my-8" />
			<h4 class="mb-2 mt-6 text-base font-semibold text-foreground">
				{{ t('styleCustomizer.terminalThemeJsonEditorTitle') }}
			</h4>
			<p class="mb-3 text-sm leading-relaxed text-text-secondary">
				{{ t('styleCustomizer.terminalThemeJsonEditorDesc') }}
			</p>
			<UiFormField :label="t('styleCustomizer.terminalThemeJsonEditorTitle')" class="mt-4">
				<UiTextarea
					v-model="themeJson"
					class="min-h-[150px] resize-y whitespace-pre-wrap break-words font-mono text-sm leading-snug md:min-h-[200px]"
					spellcheck="false"
					@focus="rawThemeEditing = true"
					@blur="finishRawThemeEditing"
				/>
				<p
					v-if="themeParseError"
					class="mt-2 rounded border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
				>
					{{ themeParseError }}
				</p>
			</UiFormField>

			<div class="mt-4 flex justify-end gap-2 border-t border-border pt-4">
				<UiButton @click="editorVisible = false">{{ t('common.cancel') }}</UiButton>
				<UiButton appearance="solid" tone="primary" @click="saveTheme">{{ t('common.save') }}</UiButton>
			</div>
		</section>
	</section>
</template>
