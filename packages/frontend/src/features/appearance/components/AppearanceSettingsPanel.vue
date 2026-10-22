<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInput, UiSettingsGroup } from '@/foundation/ui';
	import { useSettingsReloadSource, useFeedbackMessage } from '@/shared/feedback/public';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { defaultWindowThemeColor } from '../config/default-theme';
	import { useAppearanceStore } from '../store/appearance.store';
	import { useAppearanceEditor } from '../composables/use-appearance-editor';
	const emit = defineEmits<{ customize: [] }>();
	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const { t } = useI18n();
	const store = useAppearanceStore();
	const editor = useAppearanceEditor({ available: () => props.active });
	const scope = useAuthenticatedViewScope({ available: () => props.active });
	const draft = ref(defaultWindowThemeColor);
	const saving = editor.busy;
	const loadError = ref(false);
	let failureCause: unknown;
	useFeedbackMessage(
		() => (props.active && loadError.value ? t('settings.appearance.loadFailed') : ''),
		undefined,
		() => failureCause,
	);
	let baseline: number | null = null;
	let original = defaultWindowThemeColor;

	const normalize = (value: string): string | null =>
		/^#[0-9a-f]{6}$/iu.test(value.trim()) ? value.trim().toUpperCase() : null;

	const valid = computed(() => normalize(draft.value) !== null);
	const dirty = computed(() => draft.value !== original);
	useSettingsReloadSource({
		id: 'appearance-settings',

		pending: () => !store.busy && (store.blocked || loadError.value),

		reload: refresh,
	});

	function sync(): void {
		if (!store.snapshot) {
			return;
		}
		draft.value = store.snapshot.windowThemeColor;
		original = draft.value;
		baseline = store.snapshot.version;
	}

	watch(
		() => store.snapshot,
		() => {
			if (baseline === null || draft.value === original) {
				sync();
			}
		},
		{ immediate: true },
	);

	async function refresh(): Promise<void> {
		const signal = scope.capture();
		try {
			await store.load(true, signal);
			if (scope.isCurrent(signal)) {
				loadError.value = false;
				sync();
			}
		} catch (cause) {
			if (scope.isCurrent(signal)) {
				failureCause = cause;
				loadError.value = true;
			}
		}
	}

	watch(
		() => props.active,
		(active) => {
			if (active) {
				const signal = scope.capture();
				void store
					.load(false, signal)
					.then(() => {
						if (scope.isCurrent(signal)) {
							loadError.value = false;
							if (baseline === null || draft.value === original) {
								sync();
							}
						}
					})
					.catch((cause) => {
						if (scope.isCurrent(signal)) {
							failureCause = cause;
							loadError.value = true;
						}
					});
			}
		},
		{ immediate: true },
	);

	async function save(): Promise<void> {
		const value = normalize(draft.value);
		const version = baseline;
		if (!value || version === null || !props.active) {
			return;
		}
		const signal = scope.capture();
		const saved = await editor.run(() => store.update({ windowThemeColor: value }, version, signal));
		if (scope.isCurrent(signal)) {
			if (saved) {
				sync();
			}
		}
	}

	async function reset(): Promise<void> {
		draft.value = defaultWindowThemeColor;
		await save();
	}

	function pick(event: Event): void {
		if (event.target instanceof HTMLInputElement) {
			draft.value = event.target.value.toUpperCase();
		}
	}
</script>

<template>
	<section class="settings-surface">
		<div class="ui-settings-groups">
			<UiSettingsGroup :title="t('settings.appearance.title')" icon="fa-solid fa-palette" tone="accent">
				<template #actions>
					<UiButton appearance="solid" tone="primary" @click="emit('customize')">
						{{ t('settings.appearance.customizeButton') }}
					</UiButton>
				</template>
			</UiSettingsGroup>

			<UiSettingsGroup
				:title="t('settings.appearance.windowThemeColor.title')"
				icon="fa-solid fa-window-maximize"
				tone="info"
			>
				<template #actions>
					<UiButton
						:appearance="dirty ? 'solid' : 'soft'"
						:tone="dirty ? 'primary' : 'neutral'"
						:disabled="saving || !valid || !dirty"
						:loading="saving"
						@click="save"
					>
						{{ t('settings.appearance.windowThemeColor.save') }}
					</UiButton>
					<UiButton :disabled="saving" @click="reset">
						{{ t('settings.appearance.windowThemeColor.reset') }}
					</UiButton>
				</template>
				<UiFormField :label="t('settings.appearance.windowThemeColor.label')" for-id="windowThemeColorInput">
					<div class="flex flex-wrap items-center gap-3">
						<label
							class="appearance-color-picker"
							:aria-label="t('settings.appearance.windowThemeColor.label')"
							:title="t('settings.appearance.windowThemeColor.label')"
						>
							<input
								:disabled="saving || store.busy || store.blocked || !store.loaded"
								type="color"
								:value="draft"
								class="sr-only"
								@input="pick"
							/>
							<span class="appearance-color-picker__ring" :style="{ '--swatch-color': draft }"></span>
						</label>
						<UiInput
							id="windowThemeColorInput"
							:disabled="saving || store.busy || store.blocked || !store.loaded"
							v-model="draft"
							maxlength="7"
							spellcheck="false"
							autocomplete="off"
							class="h-10 !w-32 font-mono"
							@keyup.enter="save"
						/>
					</div>
					<p v-if="!valid" class="mt-2 text-sm text-error">
						{{ t('settings.appearance.windowThemeColor.invalid') }}
					</p>
				</UiFormField>
			</UiSettingsGroup>
		</div>
	</section>
</template>

<style scoped>
	.appearance-color-picker {
		display: grid;
		width: 42px;
		height: 42px;
		flex: 0 0 auto;
		place-items: center;
		border: 1px solid var(--glass-border-color);
		border-radius: 12px;
		background: var(--input-bg-color);
		box-shadow: var(--glass-inset-highlight);
		cursor: pointer;
	}

	.appearance-color-picker:focus-within {
		border-color: var(--input-focus-border-color);
		box-shadow: 0 0 0 3px var(--input-focus-glow);
	}

	.appearance-color-picker__ring {
		width: 28px;
		height: 28px;
		border: 1px solid color-mix(in srgb, var(--text-color) 18%, transparent);
		border-radius: 8px;
		background: var(--swatch-color);
		box-shadow: inset 0 1px 0 rgb(255 255 255 / 22%);
	}
</style>
