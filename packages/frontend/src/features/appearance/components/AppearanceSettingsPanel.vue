<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInput } from '@/foundation/ui';
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
	const status = ref<'saved' | 'error' | null>(null);
	let baseline: number | null = null;
	let original = defaultWindowThemeColor;

	const normalize = (value: string): string | null =>
		/^#[0-9a-f]{6}$/iu.test(value.trim()) ? value.trim().toUpperCase() : null;

	const valid = computed(() => normalize(draft.value) !== null);

	function sync(): void {
		if (!store.snapshot) {
			return;
		}
		draft.value = store.snapshot.windowThemeColor;
		original = draft.value;
		baseline = store.snapshot.version;
		status.value = null;
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
		} catch {
			if (scope.isCurrent(signal)) {
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
					.catch(() => {
						if (scope.isCurrent(signal)) {
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
			status.value = saved ? 'saved' : 'error';
			if (saved) {
				sync();
				status.value = 'saved';
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
			status.value = null;
		}
	}
</script>

<template>
	<section class="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
		<h2 class="border-b border-border bg-header/60 px-6 py-4 text-lg font-semibold text-foreground">
			{{ t('settings.category.appearance') }}
		</h2>
		<div class="space-y-6 p-6">
			<p v-if="store.blocked" role="status">{{ t('appearanceNext.refreshRequired') }}</p>
			<UiButton v-if="store.blocked || loadError" :disabled="store.busy" @click="refresh">{{
				t('appearanceNext.refresh')
			}}</UiButton>
			<p v-if="loadError" class="rounded border border-error/40 bg-error/5 p-3 text-sm text-error">
				{{ t('settings.appearance.loadFailed') }}
			</p>
			<div>
				<h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.appearance.title') }}</h3>
				<p class="mb-4 text-sm text-text-secondary">{{ t('settings.appearance.description') }}</p>
				<UiButton appearance="solid" tone="primary" @click="emit('customize')">
					{{ t('settings.appearance.customizeButton') }}
				</UiButton>
			</div>

			<hr class="border-border/50" />

			<div>
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.appearance.windowThemeColor.title') }}
				</h3>
				<p class="mb-4 text-sm text-text-secondary">
					{{ t('settings.appearance.windowThemeColor.description') }}
				</p>
				<label for="windowThemeColorInput" class="mb-2 block text-sm font-medium text-foreground">
					{{ t('settings.appearance.windowThemeColor.label') }}
				</label>
				<div class="flex flex-wrap items-center gap-3">
					<input
						:disabled="saving || store.busy || store.blocked || !store.loaded"
						type="color"
						:value="draft"
						class="h-10 w-14 cursor-pointer rounded border border-border bg-background"
						@input="pick"
					/>
					<UiInput
						id="windowThemeColorInput"
						:disabled="saving || store.busy || store.blocked || !store.loaded"
						v-model="draft"
						maxlength="7"
						spellcheck="false"
						autocomplete="off"
						class="h-10 !w-32 font-mono"
						@input="status = null"
						@keyup.enter="save"
					/>
					<UiButton
						appearance="solid"
						tone="primary"
						:disabled="saving || !valid"
						:loading="saving"
						@click="save"
					>
						{{ t('settings.appearance.windowThemeColor.save') }}
					</UiButton>
					<UiButton :disabled="saving" @click="reset">
						{{ t('settings.appearance.windowThemeColor.reset') }}
					</UiButton>
				</div>
				<p v-if="!valid" class="mt-2 text-sm text-error">
					{{ t('settings.appearance.windowThemeColor.invalid') }}
				</p>
				<p v-else-if="status === 'saved'" class="mt-2 text-sm text-success">
					{{ t('settings.appearance.windowThemeColor.saved') }}
				</p>
				<p v-else-if="status === 'error'" class="mt-2 text-sm text-error">
					{{ t('settings.appearance.windowThemeColor.saveFailed') }}
				</p>
			</div>
		</div>
	</section>
</template>
