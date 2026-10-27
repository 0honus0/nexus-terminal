<script setup lang="ts">
	import { computed, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiButton,
		UiEmptyState,
		UiFormField,
		UiInlineNotice,
		UiInput,
		UiSelect,
		UiSurface,
		UiTextarea,
	} from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import { themeApi } from '../api/theme-api';
	import type { TerminalTheme } from '../model/appearance-types';
	import { readTerminalThemeColors } from '@nexus-terminal/shared/preferences/themes/http-codec';
	import { formatThemeObject } from '../model/theme-editor';
	import { useAppearanceStore } from '../store/appearance.store';
	import { useAppearanceEditor } from '../composables/use-appearance-editor';
	import AppearancePresetToolbar from './AppearancePresetToolbar.vue';
	const { t } = useI18n();
	const feedback = useFeedback();
	const store = useAppearanceStore();
	const editor = useAppearanceEditor();
	const editorVisible = ref(false);
	const editingTheme = ref<TerminalTheme | null>(null);
	const themeName = ref('');
	const themeDraft = reactive<Record<string, string>>({});
	const themeJson = ref('{}');
	const themeParseError = ref('');
	const rawThemeEditing = ref(false);
	const importInput = ref<HTMLInputElement | null>(null);
	const search = ref('');
	const activeTheme = computed(
		() => store.themes.find((theme) => theme.id === store.settings.activeTerminalThemeId) ?? null,
	);
	const sortedThemes = computed(() => [...store.themes].sort((a, b) => a.name.localeCompare(b.name)));
	const themeOptions = computed(() => [
		{ value: null, label: t('styleCustomizer.defaultTheme') },
		...sortedThemes.value.map((theme) => ({ value: theme.id, label: theme.name })),
	]);
	const swatchKeys = ['background', 'foreground', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const;
	const filteredThemes = computed(() =>
		sortedThemes.value.filter((theme) => theme.name.toLowerCase().includes(search.value.trim().toLowerCase())),
	);
	const themeFields = computed(() => Object.keys(themeDraft).sort((left, right) => left.localeCompare(right)));

	function replaceThemeDraft(value: Record<string, string>): void {
		for (const key of Object.keys(themeDraft)) {
			delete themeDraft[key];
		}
		Object.assign(themeDraft, value);
		themeJson.value = formatThemeObject(themeDraft);
		themeParseError.value = '';
	}

	watch(
		themeDraft,
		() => {
			if (!rawThemeEditing.value) {
				themeJson.value = formatThemeObject(themeDraft);
			}
		},
		{ deep: true },
	);

	function selectTheme(value: string | number | null): void {
		if (value === null || typeof value === 'number') {
			void applyTheme(value);
		}
	}

	async function applyTheme(id: number | null): Promise<void> {
		const version = store.version;
		if (version !== null) {
			await editor.run((signal) => store.update({ activeTerminalThemeId: id }, version, signal));
		}
	}

	function openCreate(): void {
		editingTheme.value = null;
		themeName.value = t('styleCustomizer.newThemeDefaultName');
		replaceThemeDraft({ foreground: '#ffffff', background: '#000000' });
		editorVisible.value = true;
	}

	function openEdit(theme: TerminalTheme): void {
		editingTheme.value = theme.preset
			? null
			: {
					id: theme.id,
					version: theme.version,
					name: theme.name,
					themeData: { ...theme.themeData },
					preset: theme.preset,
					createdAt: theme.createdAt,
					updatedAt: theme.updatedAt,
				};
		themeName.value = theme.preset ? t('styleCustomizer.themeCopyName', { name: theme.name }) : theme.name;
		replaceThemeDraft(theme.themeData);
		editorVisible.value = true;
	}

	function applyThemeJson(): boolean {
		try {
			replaceThemeDraft(readTerminalThemeColors(JSON.parse(themeJson.value)));
			return true;
		} catch {
			themeParseError.value = t('appearanceNext.invalid');
			return false;
		}
	}

	function finishRawThemeEditing(): void {
		rawThemeEditing.value = false;
		applyThemeJson();
	}

	async function saveTheme(): Promise<void> {
		if (!applyThemeJson()) {
			return;
		}
		const colors = readTerminalThemeColors(themeDraft);
		const original = editingTheme.value;
		const name = themeName.value;
		if (
			await editor.run((permission) =>
				store.mutate(
					(signal) =>
						original
							? themeApi.update(original, name, colors, signal)
							: themeApi.create(name, colors, signal),
					permission,
					(value) => {
						store.themes = [...store.themes.filter((item) => item.id !== value.id), value];
					},
				),
			)
		) {
			editorVisible.value = false;
		}
	}

	async function removeTheme(theme: TerminalTheme): Promise<void> {
		if (theme.preset) {
			return;
		}
		const permission = editor.capture();
		if (
			!(await feedback.confirm({
				message: t('styleCustomizer.confirmDeleteTheme', { name: theme.name }),
				destructive: true,
				signal: permission,
			})) ||
			!editor.isCurrent(permission)
		) {
			return;
		}
		await editor.run(() =>
			store.mutate(
				(signal) => themeApi.remove(theme, signal),
				permission,
				() => {
					store.themes = store.themes.filter((item) => item.id !== theme.id);
				},
			),
		);
		// Theme deletion clears the active reference in the backend transaction; read the authoritative shared appearance version.
		if (editor.isCurrent(permission) && !store.blocked) {
			await editor.run((permission) => store.load(true, permission), { notify: false });
		}
	}

	async function importTheme(event: Event): Promise<void> {
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) {
			return;
		}
		const file = input.files?.[0];
		input.value = '';
		if (!file) {
			return;
		}
		await editor.run((permission) =>
			store.mutate(
				(signal) => themeApi.importFile(file, signal),
				permission,
				(value) => {
					store.themes = [...store.themes, value];
				},
			),
		);
	}

	async function exportActive(): Promise<void> {
		const value = activeTheme.value;
		if (value) {
			await editor.run((permission) => themeApi.exportFile(value, permission), { notify: false });
		}
	}

	const labelForThemeField = (key: string): string =>
		key.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase());
</script>

<template>
	<fieldset
		class="m-0 min-w-0 border-0 p-0"
		:disabled="store.busy || editor.busy.value || store.blocked || !store.loaded"
	>
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
					<li v-if="filteredThemes.length === 0">
						<UiEmptyState
							compact
							:bordered="false"
							icon="fa-solid fa-palette"
							:title="t('styleCustomizer.noThemesFound')"
						/>
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
								<UiButton
									v-if="!theme.preset"
									density="compact"
									tone="danger"
									@click="removeTheme(theme)"
								>
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

				<UiFormField for-id="terminal-theme-name" :label="t('styleCustomizer.themeName')">
					<UiInput id="terminal-theme-name" v-model="themeName" />
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
					<UiInlineNotice v-if="themeParseError" class="mt-2" tone="danger" compact>
						{{ themeParseError }}
					</UiInlineNotice>
				</UiFormField>

				<div class="mt-4 flex justify-end gap-2 border-t border-border pt-4">
					<UiButton @click="editorVisible = false">{{ t('common.cancel') }}</UiButton>
					<UiButton appearance="solid" tone="primary" @click="saveTheme">{{ t('common.save') }}</UiButton>
				</div>
			</section>
		</section>
	</fieldset>
</template>
