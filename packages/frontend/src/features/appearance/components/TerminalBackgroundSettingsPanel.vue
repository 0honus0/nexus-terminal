<script setup lang="ts">
	import { computed, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiCheckbox,
		UiFormField,
		UiInput,
		UiModal,
		UiSelect,
		UiSlider,
		UiSpinner,
		UiSurface,
		UiSwitch,
		UiTextarea,
	} from '@/foundation/ui';
	import AppearancePresetToolbar from './AppearancePresetToolbar.vue';
	import { useFeedback } from '@/shared/feedback/public';
	import { appearanceApi } from '../api/appearance-api';
	import { htmlThemeApi } from '../api/html-theme-api';
	import type { LocalHtmlTheme, RemoteHtmlTheme, AppearancePatch } from '../model/appearance-types';
	import { useAppearanceStore } from '../store/appearance.store';
	import { useAppearanceEditor } from '../composables/use-appearance-editor';
	type BackgroundSection = 'all' | 'background' | 'text-effects';
	const props = withDefaults(defineProps<{ section?: BackgroundSection }>(), { section: 'all' });
	const showPageBackground = computed(() => props.section === 'all');
	const showBackground = computed(() => props.section === 'all' || props.section === 'background');
	const showTextEffects = computed(() => props.section === 'all' || props.section === 'text-effects');
	const { t } = useI18n();
	const feedback = useFeedback();
	const store = useAppearanceStore();
	const editor = useAppearanceEditor();
	const localThemes = computed(() => store.localThemes);
	const remoteThemes = ref<RemoteHtmlTheme[]>([]);
	const loadingLocal = computed(() => !store.loaded && !store.error);
	const loadingRemote = ref(false);
	const remoteRepositoryUrl = ref('');
	const presetEditorVisible = ref(false);
	const editingLocalName = ref<string | null>(null);
	let editingLocal: LocalHtmlTheme | null = null;
	const presetName = ref('');
	const presetContent = ref('');
	const localSearch = ref('');
	const remoteSearch = ref('');
	const htmlThemeTab = ref<'local' | 'remote'>('local');
	const pageBackgroundInput = ref<HTMLInputElement | null>(null);
	const terminalBackgroundInput = ref<HTMLInputElement | null>(null);
	const form = reactive({
		terminalBackgroundEnabled: true,
		terminalBackgroundOverlayOpacity: 0.5,
		terminalCustomHtml: '',
		terminalTextStrokeEnabled: false,
		terminalTextStrokeWidth: 1,
		terminalTextStrokeColor: '#000000',
		terminalTextShadowEnabled: false,
		terminalTextShadowOffsetX: 0,
		terminalTextShadowOffsetY: 0,
		terminalTextShadowBlur: 0,
		terminalTextShadowColor: 'rgba(0,0,0,0.5)',
	});
	let baseline: number | null = null;
	let repositoryBaseline: number | null = null;
	let syncing = false;
	const dirty = ref(false);
	let repositoryOriginal = '';

	function sync(): void {
		const value = store.snapshot;
		if (!value) {
			return;
		}
		syncing = true;
		form.terminalBackgroundEnabled = value.terminalBackgroundEnabled;
		form.terminalBackgroundOverlayOpacity = value.terminalBackgroundOverlayOpacity;
		form.terminalCustomHtml = value.terminalCustomHtml;
		form.terminalTextStrokeEnabled = value.terminalTextStrokeEnabled;
		form.terminalTextStrokeWidth = value.terminalTextStrokeWidth;
		form.terminalTextStrokeColor = value.terminalTextStrokeColor;
		form.terminalTextShadowEnabled = value.terminalTextShadowEnabled;
		form.terminalTextShadowOffsetX = value.terminalTextShadowOffsetX;
		form.terminalTextShadowOffsetY = value.terminalTextShadowOffsetY;
		form.terminalTextShadowBlur = value.terminalTextShadowBlur;
		form.terminalTextShadowColor = value.terminalTextShadowColor;
		baseline = value.version;
		syncing = false;
		dirty.value = false;
	}

	watch(
		form,
		() => {
			if (!syncing) {
				dirty.value = true;
			}
		},
		{ deep: true, flush: 'sync' },
	);
	watch(
		() => store.snapshot,
		(value) => {
			if (!dirty.value) {
				sync();
			}
			if (value && remoteRepositoryUrl.value === repositoryOriginal) {
				remoteRepositoryUrl.value = value.remoteHtmlPresetsUrl ?? '';
				repositoryOriginal = remoteRepositoryUrl.value;
				repositoryBaseline = value.version;
			}
		},
		{ immediate: true },
	);
	const filteredLocalThemes = computed(() =>
		localThemes.value.filter((value) => value.name.toLowerCase().includes(localSearch.value.trim().toLowerCase())),
	);
	const filteredRemoteThemes = computed(() =>
		remoteThemes.value.filter((value) =>
			value.name.toLowerCase().includes(remoteSearch.value.trim().toLowerCase()),
		),
	);

	let remoteRead = 0;

	async function loadRemoteThemes(): Promise<void> {
		const permission = editor.capture();
		const request = ++remoteRead;
		const url = remoteRepositoryUrl.value;
		loadingRemote.value = true;
		try {
			await editor.run(async () => {
				const values = await htmlThemeApi.listRemote(url, permission);
				if (editor.isCurrent(permission) && request === remoteRead && remoteRepositoryUrl.value === url) {
					remoteThemes.value = values;
				}
			});
		} finally {
			if (editor.isCurrent(permission) && request === remoteRead) {
				loadingRemote.value = false;
			}
		}
	}

	async function savePatch(patch: AppearancePatch): Promise<void> {
		const version = baseline;
		if (version !== null && (await editor.run((permission) => store.update(patch, version, permission)))) {
			sync();
		}
	}

	async function saveVisuals(): Promise<void> {
		await savePatch({
			terminalBackgroundEnabled: form.terminalBackgroundEnabled,
			terminalBackgroundOverlayOpacity: form.terminalBackgroundOverlayOpacity,
			terminalCustomHtml: form.terminalCustomHtml,
			terminalTextStrokeEnabled: form.terminalTextStrokeEnabled,
			terminalTextStrokeWidth: form.terminalTextStrokeWidth,
			terminalTextStrokeColor: form.terminalTextStrokeColor,
			terminalTextShadowEnabled: form.terminalTextShadowEnabled,
			terminalTextShadowOffsetX: form.terminalTextShadowOffsetX,
			terminalTextShadowOffsetY: form.terminalTextShadowOffsetY,
			terminalTextShadowBlur: form.terminalTextShadowBlur,
			terminalTextShadowColor: form.terminalTextShadowColor,
		});
	}

	async function uploadBackground(kind: 'page' | 'terminal', event: Event): Promise<void> {
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) {
			return;
		}
		const file = input.files?.[0];
		input.value = '';
		const version = store.version;
		if (!file || version === null) {
			return;
		}
		await editor.run((permission) =>
			store.mutate(
				(signal) => appearanceApi.uploadBackground(kind, file, version, signal),
				permission,
				(result) => {
					store.accept(result.appearance);
					// Upload is a confirmed write by this editor. Advance only its
					// CAS baseline while preserving unsaved visual form changes.
					baseline = result.appearance.version;
					if (result.cleanupPending) {
						feedback.notifyWarning(t('appearanceNext.cleanupPending'));
					}
				},
			),
		);
	}

	async function removeBackground(kind: 'page' | 'terminal'): Promise<void> {
		const version = store.version;
		if (version === null) {
			return;
		}
		await editor.run((permission) =>
			store.mutate(
				(signal) => appearanceApi.removeBackground(kind, version, signal),
				permission,
				(result) => {
					store.accept(result.appearance);
					baseline = result.appearance.version;
					if (result.cleanupPending) {
						feedback.notifyWarning(t('appearanceNext.cleanupPending'));
					}
				},
			),
		);
	}

	function openNewPreset(): void {
		editingLocal = null;
		editingLocalName.value = null;
		presetName.value = '';
		presetContent.value = form.terminalCustomHtml;
		presetEditorVisible.value = true;
	}

	async function openLocalPreset(theme: LocalHtmlTheme): Promise<void> {
		const original: LocalHtmlTheme = {
			name: theme.name,
			type: theme.type,
			version: theme.version,
			updatedAt: theme.updatedAt,
		};
		await editor.run(async (permission) => {
			const content = await htmlThemeApi.read(original.name, permission);
			if (!editor.isCurrent(permission)) {
				return;
			}
			editingLocal = original.type === 'custom' ? original : null;
			editingLocalName.value = editingLocal?.name ?? null;
			presetName.value = editingLocal ? original.name : original.name.replace(/\.html$/iu, '-copy.html');
			presetContent.value = content;
			presetEditorVisible.value = true;
		});
	}

	function normalizedPresetName(): string {
		const name = presetName.value.trim();
		return name.endsWith('.html') ? name : name + '.html';
	}

	async function saveLocalPreset(): Promise<void> {
		const name = normalizedPresetName();
		const content = presetContent.value;
		const original = editingLocal;
		const update = original?.name === name ? original : null;
		if (
			await editor.run((permission) =>
				store.mutate(
					(signal) =>
						update
							? htmlThemeApi.update(update, content, signal)
							: htmlThemeApi.create(name, content, signal),
					permission,
					(value) => {
						store.localThemes = [
							...store.localThemes.filter((item) => item.name !== value.name || item.type !== 'custom'),
							value,
						];
					},
				),
			)
		) {
			presetEditorVisible.value = false;
		}
	}

	async function applyContent(read: (permission: AbortSignal) => Promise<string>): Promise<void> {
		const version = store.version;
		if (version === null) {
			return;
		}
		await editor.run(async (permission) => {
			const content = await read(permission);
			if (!editor.isCurrent(permission)) {
				return;
			}
			await store.update({ terminalCustomHtml: content, terminalBackgroundEnabled: true }, version, permission);
		});
	}

	async function applyLocalPreset(theme: LocalHtmlTheme): Promise<void> {
		await applyContent((signal) => htmlThemeApi.read(theme.name, signal));
	}

	async function deleteLocalPreset(theme: LocalHtmlTheme): Promise<void> {
		if (theme.type !== 'custom') {
			return;
		}
		const permission = editor.capture();
		if (
			!(await feedback.confirm({
				message: t('styleCustomizer.confirmDeletePreset', { name: theme.name }),
				destructive: true,
				signal: permission,
			})) ||
			!editor.isCurrent(permission)
		) {
			return;
		}
		await editor.run(() =>
			store.mutate(
				(signal) => htmlThemeApi.remove(theme, signal),
				permission,
				() => {
					store.localThemes = store.localThemes.filter(
						(value) => value.type !== 'custom' || value.name !== theme.name,
					);
				},
			),
		);
	}

	async function saveRemoteRepository(): Promise<void> {
		const value = remoteRepositoryUrl.value.trim() || null;
		const version = repositoryBaseline;
		const original = store.snapshot;
		if (version === null || !original) {
			return;
		}
		if (
			await editor.run((permission) =>
				store.mutate(
					(signal) => htmlThemeApi.updateRepository(value, version, signal),
					permission,
					(result) => {
						store.accept({ ...original, version: result.version, remoteHtmlPresetsUrl: result.url });
					},
				),
			)
		) {
			repositoryBaseline = store.version;
			repositoryOriginal = value ?? '';
			remoteThemes.value = [];
		}
	}

	async function applyRemotePreset(theme: RemoteHtmlTheme): Promise<void> {
		await applyContent((signal) => htmlThemeApi.readRemote(theme.downloadUrl, signal));
	}

	async function toggleTerminalBackground(enabled: boolean): Promise<void> {
		await savePatch({ terminalBackgroundEnabled: enabled });
	}

	async function saveBackgroundOverlayOpacity(): Promise<void> {
		await savePatch({ terminalBackgroundOverlayOpacity: form.terminalBackgroundOverlayOpacity });
	}

	async function clearCustomHtml(): Promise<void> {
		await savePatch({ terminalCustomHtml: '' });
	}
</script>

<template>
	<fieldset
		class="m-0 min-w-0 border-0 p-0"
		:disabled="store.busy || editor.busy.value || store.blocked || !store.loaded"
	>
		<section class="min-w-0 space-y-4">
			<template v-if="props.section === 'background'">
				<h3 class="mb-4 mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground">
					{{ t('styleCustomizer.backgroundSettings') }}
				</h3>

				<UiSurface surface="inset" class="space-y-3 p-3">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="min-w-0">
							<h4 class="m-0 text-base font-semibold text-foreground">
								{{ t('styleCustomizer.pageBackground') }}
							</h4>
							<p class="mt-1 break-all text-xs text-text-secondary">
								{{ store.settings.pageBackgroundImage || t('styleCustomizer.noBackground') }}
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
							<UiButton density="compact" @click="pageBackgroundInput?.click()">
								{{ t('styleCustomizer.uploadPageBg') }}
							</UiButton>
							<UiButton
								v-if="store.settings.pageBackgroundImage"
								density="compact"
								appearance="solid"
								tone="danger"
								@click="removeBackground('page')"
							>
								{{ t('styleCustomizer.removePageBg') }}
							</UiButton>
						</div>
					</div>
					<input
						ref="pageBackgroundInput"
						type="file"
						accept="image/*"
						class="hidden"
						@change="uploadBackground('page', $event)"
					/>
				</UiSurface>

				<hr class="my-4 border-border md:my-8" />

				<div class="mb-3 flex items-center justify-between">
					<h4 class="m-0 text-base font-semibold text-foreground">
						{{ t('styleCustomizer.terminalBackground') }}
					</h4>
					<UiSwitch
						:model-value="form.terminalBackgroundEnabled"
						:aria-label="t('styleCustomizer.terminalBackground')"
						@update:model-value="toggleTerminalBackground"
					/>
				</div>

				<template v-if="form.terminalBackgroundEnabled">
					<div
						class="relative mb-2 flex h-[100px] w-full items-center justify-center overflow-hidden rounded border border-dashed border-border bg-header bg-cover bg-center bg-no-repeat text-text-secondary md:h-[150px]"
						:style="{
							backgroundImage: store.settings.terminalBackgroundImage
								? `url(${store.settings.terminalBackgroundImage})`
								: 'none',
						}"
					>
						<div
							v-if="store.settings.terminalBackgroundImage"
							class="absolute inset-0"
							:style="{ backgroundColor: `rgb(0 0 0 / ${form.terminalBackgroundOverlayOpacity})` }"
						></div>
						<span
							v-else
							class="relative z-10 rounded bg-[var(--app-bg-color)]/80 px-3 py-1.5 text-sm font-medium text-foreground shadow-sm"
						>
							{{ t('styleCustomizer.noBackground') }}
						</span>
					</div>
					<div class="mb-4 flex flex-wrap items-center gap-2">
						<UiButton density="compact" @click="terminalBackgroundInput?.click()">{{
							t('styleCustomizer.uploadTerminalBg')
						}}</UiButton>
						<UiButton
							density="compact"
							appearance="solid"
							tone="danger"
							:disabled="!store.settings.terminalBackgroundImage"
							@click="removeBackground('terminal')"
						>
							{{ t('styleCustomizer.removeTerminalBg') }}
						</UiButton>
						<input
							ref="terminalBackgroundInput"
							type="file"
							accept="image/*"
							class="hidden"
							@change="uploadBackground('terminal', $event)"
						/>
					</div>

					<div class="mt-4 border-t border-border/50 pt-4">
						<label class="mb-1 block text-sm font-medium text-foreground">{{
							t('styleCustomizer.terminalBgOverlayOpacity')
						}}</label>
						<div class="flex items-center gap-3">
							<UiSlider
								v-model="form.terminalBackgroundOverlayOpacity"
								:min="0"
								:max="1"
								:step="0.01"
								:aria-label="t('styleCustomizer.terminalBgOverlayOpacity')"
							/>
							<span class="min-w-[3em] text-right text-sm text-foreground">{{
								form.terminalBackgroundOverlayOpacity.toFixed(2)
							}}</span>
							<UiButton density="compact" @click="saveBackgroundOverlayOpacity">{{
								t('common.save')
							}}</UiButton>
						</div>
					</div>

					<hr class="my-6 border-border" />
					<div class="mb-3 flex items-center gap-2">
						<h4 class="m-0 text-base font-semibold text-foreground">
							{{ t('styleCustomizer.htmlBackgroundThemes') }}
						</h4>
						<UiButton
							density="compact"
							appearance="ghost"
							icon-only
							:title="t('common.restore')"
							:aria-label="t('common.restore')"
							@click="clearCustomHtml"
						>
							<i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
						</UiButton>
					</div>

					<UiFormField :label="t('styleCustomizer.htmlBackgroundThemes')" class="mb-4">
						<UiSelect
							v-model="htmlThemeTab"
							:aria-label="t('styleCustomizer.htmlBackgroundThemes')"
							:options="[
								{ value: 'local', label: t('styleCustomizer.localThemes') },
								{ value: 'remote', label: t('styleCustomizer.remoteThemes') },
							]"
							match-trigger-width
						/>
					</UiFormField>

					<div v-if="htmlThemeTab === 'local'">
						<AppearancePresetToolbar
							v-model="localSearch"
							class="mb-4"
							:placeholder="t('styleCustomizer.searchLocalThemesPlaceholder')"
						>
							<UiButton density="compact" class="shrink-0" @click="openNewPreset">{{
								t('styleCustomizer.addNewTheme')
							}}</UiButton>
						</AppearancePresetToolbar>
						<div v-if="loadingLocal" class="p-4 text-center text-text-secondary">
							{{ t('common.loading') }}
						</div>
						<ul
							v-else-if="filteredLocalThemes.length"
							class="m-0 max-h-[320px] list-none space-y-2 overflow-y-auto p-0.5"
						>
							<li
								v-for="theme in filteredLocalThemes"
								:key="theme.name"
								class="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-header/30 p-3 text-sm"
							>
								<div class="flex min-w-[6rem] flex-1 items-center gap-2">
									<span class="min-w-0 truncate font-medium text-foreground" :title="theme.name">{{
										theme.name.replace(/\.html$/i, '')
									}}</span>
									<UiBadge class="shrink-0">
										{{
											t(
												theme.type === 'preset'
													? 'styleCustomizer.presetTag'
													: 'styleCustomizer.customTag',
											)
										}}
									</UiBadge>
								</div>
								<div class="ml-auto flex shrink-0 items-center gap-2">
									<UiButton density="compact" @click="applyLocalPreset(theme)">{{
										t('styleCustomizer.applyButton')
									}}</UiButton>
									<UiButton density="compact" @click="openLocalPreset(theme)">{{
										t('common.edit')
									}}</UiButton>
									<UiButton
										v-if="theme.type === 'custom'"
										density="compact"
										appearance="solid"
										tone="danger"
										@click="deleteLocalPreset(theme)"
									>
										{{ t('common.delete') }}
									</UiButton>
								</div>
							</li>
						</ul>
						<div
							v-else
							class="rounded-md border border-dashed border-border p-4 text-center italic text-text-secondary"
						>
							{{
								localSearch
									? t('styleCustomizer.noMatchingLocalPresetsFound')
									: t('styleCustomizer.noLocalPresetsFound')
							}}
						</div>
					</div>

					<div v-else>
						<UiFormField :label="t('styleCustomizer.remoteHtmlPresetsRepositoryUrl')">
							<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
								<UiInput
									v-model="remoteRepositoryUrl"
									class="min-w-0 flex-grow"
									:placeholder="t('styleCustomizer.remoteRepoUrlPlaceholder')"
								/>
								<UiButton density="compact" @click="saveRemoteRepository">{{
									t('common.save')
								}}</UiButton>
								<UiButton
									density="compact"
									:disabled="!remoteRepositoryUrl || loadingRemote"
									@click="loadRemoteThemes"
									>{{
										loadingRemote ? t('common.loading') : t('styleCustomizer.loadRemoteThemes')
									}}</UiButton
								>
							</div>
						</UiFormField>
						<AppearancePresetToolbar
							v-model="remoteSearch"
							class="my-4"
							:placeholder="t('styleCustomizer.searchRemoteThemesPlaceholder')"
						/>
						<ul
							v-if="filteredRemoteThemes.length"
							class="m-0 max-h-[320px] list-none space-y-2 overflow-y-auto p-0.5"
						>
							<li
								v-for="theme in filteredRemoteThemes"
								:key="theme.name"
								class="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-header/30 p-3 text-sm"
							>
								<span
									class="min-w-[6rem] flex-1 truncate font-medium text-foreground"
									:title="theme.name"
									>{{ theme.name.replace(/\.html$/i, '') }}</span
								>
								<div class="ml-auto flex shrink-0 items-center gap-2">
									<UiButton
										density="compact"
										:disabled="!theme.downloadUrl"
										@click="applyRemotePreset(theme)"
										>{{ t('styleCustomizer.applyButton') }}</UiButton
									>
								</div>
							</li>
						</ul>
						<div
							v-else
							class="rounded-md border border-dashed border-border p-4 text-center italic text-text-secondary"
						>
							{{
								remoteSearch
									? t('styleCustomizer.noMatchingRemotePresetsFound')
									: t('styleCustomizer.noRemotePresetsFound')
							}}
						</div>
					</div>
				</template>
				<div
					v-else
					class="rounded-md border border-dashed border-border/50 p-4 text-center italic text-text-secondary"
				>
					{{ t('styleCustomizer.terminalBgDisabled') }}
				</div>

				<UiModal
					:visible="presetEditorVisible"
					:title="
						editingLocalName ? t('styleCustomizer.editLocalPreset') : t('styleCustomizer.newLocalPreset')
					"
					:z-index="1100"
					panel-class="w-[min(820px,94vw)]"
					@close="presetEditorVisible = false"
				>
					<div class="space-y-4">
						<UiFormField :label="t('styleCustomizer.presetName')">
							<UiInput v-model="presetName" :placeholder="t('styleCustomizer.presetNamePlaceholder')" />
						</UiFormField>
						<UiFormField :label="t('styleCustomizer.presetContent')">
							<UiTextarea v-model="presetContent" class="min-h-80 font-mono text-xs" />
						</UiFormField>
						<div class="flex justify-end gap-2">
							<UiButton @click="presetEditorVisible = false">{{ t('common.cancel') }}</UiButton>
							<UiButton appearance="solid" tone="primary" @click="saveLocalPreset">{{
								t('common.save')
							}}</UiButton>
						</div>
					</div>
				</UiModal>
			</template>

			<template v-else>
				<div v-if="showPageBackground || showBackground" class="grid gap-4 md:grid-cols-2">
					<UiSurface v-if="showPageBackground" surface="inset" class="space-y-2 p-3">
						<h3 class="font-semibold">{{ t('styleCustomizer.pageBackground') }}</h3>
						<p class="break-all text-xs text-text-secondary">
							{{ store.settings.pageBackgroundImage || t('styleCustomizer.noBackground') }}
						</p>
						<UiInput type="file" accept="image/*" @change="uploadBackground('page', $event)" />
						<UiButton
							v-if="store.settings.pageBackgroundImage"
							density="compact"
							@click="removeBackground('page')"
						>
							{{ t('styleCustomizer.removePageBg') }}
						</UiButton>
					</UiSurface>

					<UiSurface v-if="showBackground" surface="inset" class="space-y-2 p-3">
						<h3 class="font-semibold">{{ t('styleCustomizer.terminalBackground') }}</h3>
						<p class="break-all text-xs text-text-secondary">
							{{ store.settings.terminalBackgroundImage || t('styleCustomizer.noBackground') }}
						</p>
						<UiInput type="file" accept="image/*" @change="uploadBackground('terminal', $event)" />
						<UiButton
							v-if="store.settings.terminalBackgroundImage"
							density="compact"
							@click="removeBackground('terminal')"
						>
							{{ t('styleCustomizer.removeTerminalBg') }}
						</UiButton>
					</UiSurface>
				</div>

				<UiSurface v-if="showBackground" surface="inset" class="space-y-4 p-3">
					<label class="flex items-center gap-2">
						<UiCheckbox v-model="form.terminalBackgroundEnabled" />
						{{ t('styleCustomizer.terminalBackgroundEnabled') }}
					</label>
					<UiFormField :label="t('styleCustomizer.terminalBgOverlayOpacity')">
						<UiSlider
							v-model="form.terminalBackgroundOverlayOpacity"
							:min="0"
							:max="1"
							:step="0.05"
							:aria-label="t('styleCustomizer.terminalBgOverlayOpacity')"
						/>
					</UiFormField>
					<UiFormField :label="t('styleCustomizer.presetContent')">
						<UiTextarea
							v-model="form.terminalCustomHtml"
							class="min-h-40 font-mono text-xs"
							:placeholder="t('styleCustomizer.customTerminalHTMLPlaceholder')"
						/>
					</UiFormField>
					<div class="flex gap-2">
						<UiButton appearance="solid" tone="primary" @click="saveVisuals">{{
							t('common.save')
						}}</UiButton>
						<UiButton @click="clearCustomHtml">{{ t('common.clear') }}</UiButton>
					</div>
				</UiSurface>

				<div v-if="showTextEffects" class="grid gap-4">
					<UiSurface surface="inset" class="min-w-0 space-y-3 p-3">
						<h3 class="font-semibold">{{ t('styleCustomizer.textStrokeSettings') }}</h3>
						<label class="flex items-center gap-2">
							<UiCheckbox v-model="form.terminalTextStrokeEnabled" />
							{{ t('styleCustomizer.enableTextStroke') }}
						</label>
						<UiFormField :label="t('styleCustomizer.textStrokeWidth')">
							<UiInput v-model="form.terminalTextStrokeWidth" type="number" />
						</UiFormField>
						<UiFormField :label="t('styleCustomizer.textStrokeColor')">
							<UiInput v-model="form.terminalTextStrokeColor" />
						</UiFormField>
					</UiSurface>

					<UiSurface surface="inset" class="min-w-0 space-y-3 p-3">
						<h3 class="font-semibold">{{ t('styleCustomizer.textShadowSettings') }}</h3>
						<label class="flex items-center gap-2">
							<UiCheckbox v-model="form.terminalTextShadowEnabled" />
							{{ t('styleCustomizer.enableTextShadow') }}
						</label>
						<div class="grid gap-2 sm:grid-cols-3">
							<UiFormField :label="t('styleCustomizer.textShadowOffsetX')">
								<UiInput v-model="form.terminalTextShadowOffsetX" type="number" />
							</UiFormField>
							<UiFormField :label="t('styleCustomizer.textShadowOffsetY')">
								<UiInput v-model="form.terminalTextShadowOffsetY" type="number" />
							</UiFormField>
							<UiFormField :label="t('styleCustomizer.textShadowBlur')">
								<UiInput v-model="form.terminalTextShadowBlur" type="number" />
							</UiFormField>
						</div>
						<UiFormField :label="t('styleCustomizer.textShadowColor')">
							<UiInput v-model="form.terminalTextShadowColor" />
						</UiFormField>
					</UiSurface>
				</div>
				<UiButton v-if="showTextEffects" appearance="solid" tone="primary" @click="saveVisuals">{{
					t('common.save')
				}}</UiButton>

				<div v-if="showBackground" class="grid gap-6 xl:grid-cols-2">
					<UiSurface surface="inset" class="min-w-0 space-y-3 p-3">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h3 class="font-semibold">{{ t('styleCustomizer.localThemes') }}</h3>
							<UiButton density="compact" appearance="solid" tone="primary" @click="openNewPreset">{{
								t('styleCustomizer.newLocalPreset')
							}}</UiButton>
						</div>
						<AppearancePresetToolbar
							v-model="localSearch"
							:placeholder="t('styleCustomizer.searchLocalThemesPlaceholder')"
						/>
						<UiSpinner v-if="loadingLocal" />
						<ul v-else class="divide-y divide-border">
							<li
								v-for="theme in filteredLocalThemes"
								:key="theme.name"
								class="flex items-center gap-2 py-2"
							>
								<span class="min-w-0 flex-1 truncate">{{ theme.name.replace(/\.html$/i, '') }}</span>
								<UiBadge>{{
									t(
										theme.type === 'preset'
											? 'styleCustomizer.presetTag'
											: 'styleCustomizer.customTag',
									)
								}}</UiBadge>
								<UiButton density="compact" @click="applyLocalPreset(theme)">{{
									t('styleCustomizer.applyButton')
								}}</UiButton>
								<UiButton density="compact" @click="openLocalPreset(theme)">{{
									theme.type === 'preset' ? t('styleCustomizer.editAsCopy') : t('common.edit')
								}}</UiButton>
								<UiButton
									v-if="theme.type === 'custom'"
									density="compact"
									appearance="solid"
									tone="danger"
									@click="deleteLocalPreset(theme)"
								>
									{{ t('common.delete') }}
								</UiButton>
							</li>
							<li v-if="!filteredLocalThemes.length" class="py-4 text-sm text-text-secondary">
								{{
									localSearch
										? t('styleCustomizer.noMatchingLocalPresetsFound')
										: t('styleCustomizer.noLocalPresetsFound')
								}}
							</li>
						</ul>
					</UiSurface>

					<UiSurface surface="inset" class="min-w-0 space-y-3 p-3">
						<h3 class="font-semibold">{{ t('styleCustomizer.remoteThemes') }}</h3>
						<UiFormField :label="t('styleCustomizer.remoteHtmlPresetsRepositoryUrl')">
							<UiInput
								v-model="remoteRepositoryUrl"
								:placeholder="t('styleCustomizer.remoteRepoUrlPlaceholder')"
							/>
						</UiFormField>
						<div class="flex gap-2">
							<UiButton
								density="compact"
								appearance="solid"
								tone="primary"
								@click="saveRemoteRepository"
								>{{ t('styleCustomizer.saveUrl') }}</UiButton
							>
							<UiButton density="compact" @click="loadRemoteThemes">{{
								t('styleCustomizer.loadRemoteThemes')
							}}</UiButton>
						</div>
						<AppearancePresetToolbar
							v-model="remoteSearch"
							:placeholder="t('styleCustomizer.searchRemoteThemesPlaceholder')"
						/>
						<UiSpinner v-if="loadingRemote" />
						<ul v-else class="divide-y divide-border">
							<li
								v-for="theme in filteredRemoteThemes"
								:key="theme.name"
								class="flex items-center gap-2 py-2"
							>
								<span class="min-w-0 flex-1 truncate">{{ theme.name.replace(/\.html$/i, '') }}</span>
								<UiButton
									density="compact"
									:disabled="!theme.downloadUrl"
									@click="applyRemotePreset(theme)"
								>
									{{ t('styleCustomizer.applyButton') }}
								</UiButton>
							</li>
							<li v-if="!filteredRemoteThemes.length" class="py-4 text-sm text-text-secondary">
								{{
									remoteSearch
										? t('styleCustomizer.noMatchingRemotePresetsFound')
										: t('styleCustomizer.noRemotePresetsFound')
								}}
							</li>
						</ul>
					</UiSurface>
				</div>

				<UiModal
					v-if="showBackground"
					:visible="presetEditorVisible"
					:title="
						editingLocalName ? t('styleCustomizer.editLocalPreset') : t('styleCustomizer.newLocalPreset')
					"
					panel-class="w-[min(820px,94vw)]"
					@close="presetEditorVisible = false"
				>
					<div class="space-y-4">
						<UiFormField :label="t('styleCustomizer.presetName')">
							<UiInput v-model="presetName" :placeholder="t('styleCustomizer.presetNamePlaceholder')" />
						</UiFormField>
						<UiFormField :label="t('styleCustomizer.presetContent')">
							<UiTextarea v-model="presetContent" class="min-h-80 font-mono text-xs" />
						</UiFormField>
						<div class="flex justify-end gap-2">
							<UiButton @click="presetEditorVisible = false">{{ t('common.cancel') }}</UiButton>
							<UiButton appearance="solid" tone="primary" @click="saveLocalPreset">{{
								t('common.save')
							}}</UiButton>
						</div>
					</div>
				</UiModal>
			</template>
		</section>
	</fieldset>
</template>
