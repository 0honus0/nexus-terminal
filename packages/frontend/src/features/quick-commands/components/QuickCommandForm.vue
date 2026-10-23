<script setup lang="ts">
	import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { useFeedback, preferenceFailureMessage } from '@/shared/feedback/public';
	import { useResizeHandle } from '@/foundation/interaction';
	import {
		UiButton,
		UiEmptyState,
		UiFormField,
		UiInput,
		UiModal,
		UiResizeHandle,
		UiTextarea,
		UiTokenInput,
		type UiTokenOption,
	} from '@/foundation/ui';
	import type {
		QuickCommandSummary,
		QuickCommandFormInput,
		QuickCommandTagSummary,
	} from '../model/quick-command-types';
	import { useQuickCommandsStore } from '../store/quickCommands.store';

	const props = defineProps<{
		visible: boolean;
		command?: QuickCommandSummary | null;
		tags: QuickCommandTagSummary[];
	}>();
	const emit = defineEmits<{
		close: [];
		save: [input: QuickCommandFormInput];
		execute: [input: QuickCommandFormInput];
	}>();
	const { t } = useI18n();
	const feedback = useFeedback();
	const store = useQuickCommandsStore();

	const MIN_DIALOG_WIDTH = 800;
	const MIN_DIALOG_HEIGHT = 440;
	const DEFAULT_DIALOG_HEIGHT = 492;
	const VIEWPORT_GAP = 32;

	const availableWidth = () => Math.max(1, window.innerWidth - VIEWPORT_GAP);

	const availableHeight = () => Math.max(1, window.innerHeight - VIEWPORT_GAP);

	const minWidth = () => Math.min(MIN_DIALOG_WIDTH, availableWidth());

	const minHeight = () => Math.min(MIN_DIALOG_HEIGHT, availableHeight());

	const defaultWidth = () => Math.min(1152, window.innerWidth * 0.9, availableWidth());

	const defaultHeight = () => Math.min(DEFAULT_DIALOG_HEIGHT, window.innerHeight * 0.78, availableHeight());

	const desktopResizable = ref(typeof window !== 'undefined' && window.innerWidth >= 768);
	const dialogWidth = ref(typeof window === 'undefined' ? 1152 : defaultWidth());
	const dialogHeight = ref(
		typeof window === 'undefined' ? MIN_DIALOG_HEIGHT : Math.max(minHeight(), defaultHeight()),
	);

	const resetDialogSize = () => {
		dialogWidth.value = Math.max(minWidth(), defaultWidth());
		dialogHeight.value = Math.max(minHeight(), defaultHeight());
	};

	const clampDialogSize = () => {
		desktopResizable.value = window.innerWidth >= 768;
		dialogWidth.value = Math.min(availableWidth(), Math.max(minWidth(), dialogWidth.value));
		dialogHeight.value = Math.min(availableHeight(), Math.max(minHeight(), dialogHeight.value));
	};

	const dialogStyle = computed(() =>
		desktopResizable.value
			? {
					width: `${dialogWidth.value}px`,
					height: `${dialogHeight.value}px`,
					maxWidth: `${availableWidth()}px`,
					maxHeight: `${availableHeight()}px`,
				}
			: {
					width: 'min(1152px, 90vw, calc(100vw - 2rem))',
					maxWidth: 'min(1152px, 90vw, calc(100vw - 2rem))',
					maxHeight: '90dvh',
				},
	);

	const resizeOptions = (widthDirection: 1 | -1 | 0, heightDirection: 1 | -1 | 0) =>
		useResizeHandle({
			width: dialogWidth,
			height: dialogHeight,
			minWidth,
			minHeight,
			maxWidth: availableWidth,
			maxHeight: availableHeight,
			widthDirection: widthDirection === 0 ? 1 : widthDirection,
			heightDirection: heightDirection === 0 ? 1 : heightDirection,
			widthMultiplier: widthDirection === 0 ? 0 : 1,
			heightMultiplier: heightDirection === 0 ? 0 : 1,

			canStart: () => desktopResizable.value,
		});

	const resizeTop = resizeOptions(0, -1);
	const resizeRight = resizeOptions(1, 0);
	const resizeBottom = resizeOptions(0, 1);
	const resizeLeft = resizeOptions(-1, 0);
	const resizeTopLeft = resizeOptions(-1, -1);
	const resizeTopRight = resizeOptions(1, -1);
	const resizeBottomRight = resizeOptions(1, 1);
	const resizeBottomLeft = resizeOptions(-1, 1);
	onMounted(() => window.addEventListener('resize', clampDialogSize));
	onBeforeUnmount(() => window.removeEventListener('resize', clampDialogSize));

	const form = reactive({
		name: '',
		command: '',
		tagIds: [] as number[],
		variables: [] as Array<{ key: string; value: string }>,
	});

	const view = useAuthenticatedViewScope({
		available: () => props.visible,

		onRevoke: () => {
			form.name = '';
			form.command = '';
			form.tagIds = [];
			form.variables = [];
		},
	});

	watch(
		() => [props.visible, props.command] as const,
		([visible]) => {
			if (!visible) {
				return;
			}
			resetDialogSize();
			const command = props.command;
			form.name = command?.name ?? '';
			form.command = command?.command ?? '';
			form.tagIds = command ? [...command.tagIds] : [];
			form.variables = Object.entries(command?.variables ?? {}).map(([key, value]) => ({ key, value }));
		},
		{ immediate: true },
	);

	const options = () => props.tags.map<UiTokenOption>((tag) => ({ value: String(tag.id), label: tag.name }));

	const createTag = async (name: string) => {
		const signal = view.capture();
		if (!view.isCurrent(signal)) {
			return;
		}
		const normalized = name.trim();
		if (!normalized) {
			return;
		}
		const existing = props.tags.find((tag) => tag.name.toLowerCase() === normalized.toLowerCase());
		try {
			const tag = existing ?? (await store.addTag(normalized, signal));
			if (view.isCurrent(signal) && !form.tagIds.includes(tag.id)) {
				form.tagIds = [...form.tagIds, tag.id];
			}
		} catch (cause) {
			if (!view.isCurrent(signal)) {
				return;
			}
			feedback.notifyError(
				t('quickCommands.tags.createTagFailed', {
					error: preferenceFailureMessage(cause, t),
				}),
			);
		}
	};

	const deleteTag = async (option: UiTokenOption) => {
		const signal = view.capture();
		if (!view.isCurrent(signal)) {
			return;
		}
		const id = Number(option.value);
		const tag = props.tags.find((item) => item.id === id);
		if (!tag) {
			return;
		}
		if (
			!(await feedback.confirm({
				message: t('quickCommands.tags.confirmDelete', { name: tag.name }),
				signal,
				destructive: true,
			}))
		) {
			return;
		}
		try {
			if (!view.isCurrent(signal)) {
				return;
			}
			await store.removeTag(tag, signal);
			if (!view.isCurrent(signal)) {
				return;
			}
			form.tagIds = form.tagIds.filter((tagId) => tagId !== id);
		} catch (cause) {
			feedback.notifyError(
				t('quickCommands.tags.deleteFailed', {
					name: tag.name,
					error: preferenceFailureMessage(cause, t),
				}),
			);
		}
	};

	const toInput = (): QuickCommandFormInput => ({
		name: form.name.trim() || null,
		command: form.command.trim(),
		tagIds: [...form.tagIds],
		variables: Object.fromEntries(
			form.variables.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value]),
		),
	});

	const save = () => {
		const input = toInput();
		if (!input.command) {
			return;
		}
		emit('save', input);
	};

	const execute = () => {
		const input = toInput();
		if (!input.command) {
			return;
		}
		emit('execute', input);
	};
</script>

<template>
	<UiModal
		:visible="visible"
		:title="t(command ? 'quickCommands.form.titleEdit' : 'quickCommands.form.titleAdd')"
		panel-class="!max-h-none !max-w-none"
		:panel-style="dialogStyle"
		content-class="!py-0"
		:close-on-backdrop="false"
		:close-on-escape="true"
		@close="emit('close')"
	>
		<template #panel-overlay>
			<template v-if="visible">
				<div class="quick-resize quick-resize--top" @pointerdown.stop="resizeTop.startResize"></div>
				<div class="quick-resize quick-resize--right" @pointerdown.stop="resizeRight.startResize"></div>
				<div class="quick-resize quick-resize--bottom" @pointerdown.stop="resizeBottom.startResize"></div>
				<div class="quick-resize quick-resize--left" @pointerdown.stop="resizeLeft.startResize"></div>
				<div class="quick-resize quick-resize--top-left" @pointerdown.stop="resizeTopLeft.startResize"></div>
				<div class="quick-resize quick-resize--top-right" @pointerdown.stop="resizeTopRight.startResize"></div>
				<UiResizeHandle
					class="quick-resize absolute bottom-0 right-0 z-30"
					:title="t('quickCommands.form.resize')"
					:aria-label="t('quickCommands.form.resize')"
					@pointerdown.stop="resizeBottomRight.startResize"
				/>
				<div
					class="quick-resize quick-resize--bottom-left"
					@pointerdown.stop="resizeBottomLeft.startResize"
				></div>
			</template>
		</template>
		<form id="quick-command-form" class="quick-command-form" @submit.prevent="save">
			<UiFormField :label="t('quickCommands.form.name')">
				<UiInput v-model="form.name" :placeholder="t('quickCommands.form.namePlaceholder')" />
			</UiFormField>

			<UiFormField :label="t('quickCommands.form.command')">
				<UiTextarea
					v-model="form.command"
					:min-rows="5"
					required
					class="min-h-[88px] whitespace-nowrap"
					:placeholder="t('quickCommands.form.commandPlaceholder')"
				/>
			</UiFormField>

			<UiFormField :label="t('quickCommands.form.tags')">
				<UiTokenInput
					:model-value="form.tagIds.map(String)"
					:options="options()"
					:placeholder="t('quickCommands.form.tagsPlaceholder')"
					:remove-token-label="t('quickCommands.tags.removeSelection')"
					:delete-option-label="t('quickCommands.tags.deleteGlobally')"
					allow-custom
					allow-option-delete
					@update:model-value="form.tagIds = $event.map(Number)"
					@create="createTag"
					@delete-option="deleteTag"
				/>
			</UiFormField>

			<section class="quick-command-variables">
				<div class="quick-command-section-heading">
					<h3>{{ t('quickCommands.form.variablesTitle') }}</h3>
					<UiButton
						type="button"
						appearance="ghost"
						density="compact"
						@click="form.variables.push({ key: '', value: '' })"
					>
						<template #leading><i class="fas fa-plus" aria-hidden="true"></i></template>
						{{ t('quickCommands.form.addVariable') }}
					</UiButton>
				</div>

				<UiEmptyState
					v-if="!form.variables.length"
					class="quick-command-variable-empty"
					dense
					icon="fas fa-code"
					:title="t('quickCommands.form.noVariables')"
				/>
				<div v-else class="quick-command-variable-list">
					<div v-for="(variable, index) in form.variables" :key="index" class="quick-command-variable-card">
						<UiInput
							v-model="variable.key"
							:placeholder="t('quickCommands.form.variableNamePlaceholder')"
							@keydown.enter.prevent.stop
						/>
						<UiTextarea
							v-model="variable.value"
							:min-rows="2"
							class="min-h-[40px] resize-y"
							:placeholder="t('quickCommands.form.variableValuePlaceholder')"
						/>
						<UiButton
							type="button"
							appearance="ghost"
							tone="danger"
							density="compact"
							class="quick-command-variable-delete"
							:title="t('common.delete')"
							:aria-label="t('common.delete')"
							@click="form.variables.splice(index, 1)"
						>
							<i class="fas fa-trash-alt" aria-hidden="true"></i>
							<span>{{ t('common.delete') }}</span>
						</UiButton>
					</div>
				</div>
			</section>
		</form>

		<template #footer>
			<div class="flex items-center justify-end gap-2">
				<UiButton type="button" @click="emit('close')">{{ t('common.cancel') }}</UiButton>
				<UiButton
					type="button"
					appearance="solid"
					tone="success"
					:disabled="!form.command.trim()"
					@click="execute"
				>
					<template #leading><i class="fas fa-play" aria-hidden="true"></i></template>
					{{ t('quickCommands.form.execute') }}
				</UiButton>
				<UiButton
					type="submit"
					form="quick-command-form"
					appearance="solid"
					tone="primary"
					:disabled="!form.command.trim()"
				>
					{{ t('common.save') }}
				</UiButton>
			</div>
		</template>
	</UiModal>
</template>

<style scoped>
	.quick-command-form {
		display: flex;
		min-height: 100%;
		flex-direction: column;
		gap: 0.9rem;
		padding-block: 0.15rem 0.25rem;
	}

	.quick-command-variables {
		display: flex;
		min-height: 0;
		flex-direction: column;
		gap: 0.55rem;
	}

	.quick-command-section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.quick-command-section-heading h3 {
		margin: 0;
		color: var(--text-color-secondary);
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1.35;
	}

	.quick-command-variable-empty {
		min-height: 2.5rem;
		padding: 0.55rem 0.7rem;
		border-radius: 0.55rem;
	}

	.quick-command-variable-list {
		display: grid;
		gap: 0.5rem;
	}

	.quick-command-variable-card {
		display: grid;
		gap: 0.5rem;
		padding: 0.65rem;
		border: 1px solid color-mix(in srgb, var(--border-color) 36%, transparent);
		border-radius: 0.6rem;
		background: color-mix(in srgb, var(--input-bg-color) 34%, transparent);
	}

	.quick-command-variable-delete {
		width: fit-content;
		justify-self: end;
	}

	.quick-resize {
		position: absolute;
		z-index: 20;
		touch-action: none;
		user-select: none;
	}
	.quick-resize--top,
	.quick-resize--bottom {
		left: 10px;
		right: 10px;
		height: 10px;
		cursor: ns-resize;
	}
	.quick-resize--top {
		top: 0;
	}
	.quick-resize--bottom {
		bottom: 0;
	}
	.quick-resize--left,
	.quick-resize--right {
		top: 10px;
		bottom: 10px;
		width: 10px;
		cursor: ew-resize;
	}
	.quick-resize--left {
		left: 0;
	}
	.quick-resize--right {
		right: 0;
	}
	.quick-resize--top-left,
	.quick-resize--top-right,
	.quick-resize--bottom-left {
		width: 14px;
		height: 14px;
	}
	.quick-resize--top-left {
		top: 0;
		left: 0;
		cursor: nwse-resize;
	}
	.quick-resize--top-right {
		top: 0;
		right: 0;
		cursor: nesw-resize;
	}
	.quick-resize--bottom-left {
		bottom: 0;
		left: 0;
		cursor: nesw-resize;
	}
	@media (max-width: 767px) {
		.quick-resize {
			display: none;
		}
	}
</style>
