<script setup lang="ts">
	import type { UiDialogProps } from '../ui-component-types.js';
	import { computed, getCurrentInstance, shallowRef, watch, type VNodeChild } from 'vue';
	import { dismissTransientOverlay } from '../ui-overlay.js';
	import { useDialogGeometry } from '../ui-dialog-geometry.js';
	import {
		DialogClose,
		DialogContent,
		DialogDescription,
		DialogOverlay,
		DialogPortal,
		DialogRoot,
		DialogTitle,
	} from 'reka-ui';
	import { X } from '@lucide/vue';
	import UiButton from './UiButton.vue';
	import UiTransition from './UiTransition.vue';
	import UiScrollArea from './UiScrollArea.vue';
	import UiResizeHandle from './UiResizeHandle.vue';
	defineOptions({ inheritAttrs: false });
	const open = defineModel<boolean>('open', { default: false });
	watch(
		open,
		(value) => {
			if (value) dismissTransientOverlay();
		},
		{ immediate: true, flush: 'sync' },
	);
	const props = withDefaults(defineProps<UiDialogProps>(), {
		modal: true,
		size: 'md',
		showClose: true,
		closeDisabled: false,
		closeOnEscape: true,
		closeOnInteractOutside: true,
		gutter: 'symmetric',
		resizable: true,
	});
	const translate = getCurrentInstance()?.appContext.config.globalProperties.$t;
	const resizeLabel = computed(
		() =>
			props.resizeLabel ??
			(typeof translate === 'function'
				? translate('desktop.resize', { title: props.title })
				: 'Resize ' + props.title),
	);
	const emit = defineEmits<{
		storageError: [cause: unknown];
		closeAutoFocus: [event: Event];
		escapeKeyDown: [event: KeyboardEvent];
	}>();
	const element = shallowRef<HTMLElement>();
	const geometry = useDialogGeometry(props, open, element, (cause) => emit('storageError', cause));
	defineSlots<{
		title?: (props: { title: string }) => VNodeChild;
		body?: (props: { close: () => void }) => VNodeChild;
		default?: (props: { close: () => void }) => VNodeChild;
		footer?: (props: { close: () => void }) => VNodeChild;
	}>();

	function close() {
		updateOpen(false);
	}

	function updateOpen(value: boolean) {
		if (!value && props.closeDisabled) return;
		open.value = value;
	}

	function escapeKeyDown(event: KeyboardEvent): void {
		if (props.closeDisabled || !props.closeOnEscape) event.preventDefault();
		else emit('escapeKeyDown', event);
	}
</script>

<template>
	<DialogRoot :open="open" :modal="props.modal" @update:open="updateOpen">
		<DialogPortal>
			<UiTransition preset="fade"
				><DialogOverlay
					v-if="props.modal && open"
					force-mount
					data-ui="dialog-overlay"
					class="ui-dialog-overlay"
			/></UiTransition>
			<UiTransition
				><DialogContent
					v-if="open"
					force-mount
					as-child
					@close-auto-focus="emit('closeAutoFocus', $event)"
					@escape-key-down="escapeKeyDown"
					@interact-outside="
						(event) => (props.closeDisabled || !props.closeOnInteractOutside) && event.preventDefault()
					"
				>
					<div
						ref="element"
						v-bind="{
							...$attrs,
							...(!props.description && !('aria-describedby' in $attrs)
								? { 'aria-describedby': undefined }
								: {}),
						}"
						data-ui="dialog"
						:data-size="props.size"
						:data-geometry="geometry.enabled.value || undefined"
						:data-draggable="(geometry.enabled.value && props.draggable) || undefined"
						:style="geometry.style.value"
						class="ui-dialog"
					>
						<div class="ui-dialog__surface">
							<UiScrollArea as-child :gutter="props.gutter" overflow="hidden"
								><header
									class="ui-dialog__header"
									:data-ui-selection="props.draggable ? 'none' : undefined"
								>
									<div class="ui-dialog__heading">
										<DialogTitle class="ui-dialog__title"
											><slot name="title" :title="props.title">{{
												props.title
											}}</slot></DialogTitle
										><DialogDescription v-if="props.description" class="ui-dialog__description">{{
											props.description
										}}</DialogDescription>
									</div>
									<DialogClose v-if="props.showClose" as-child
										><UiButton
											appearance="ghost"
											icon-only
											:disabled="props.closeDisabled"
											:aria-label="props.closeLabel"
											><X :size="18" /></UiButton
									></DialogClose></header
							></UiScrollArea>
							<slot name="body" :close="close">
								<UiScrollArea
									v-if="$slots.default"
									:gutter="props.gutter"
									:scrollbar="props.scrollbar"
									class="ui-dialog__body"
									><slot :close="close"
								/></UiScrollArea>
							</slot>
							<UiScrollArea v-if="$slots.footer" as-child :gutter="props.gutter" overflow="hidden"
								><footer class="ui-dialog__footer">
									<slot name="footer" :close="close" /></footer
							></UiScrollArea>
						</div>
						<UiResizeHandle
							v-if="geometry.enabled.value && props.resizable"
							edges
							:label="resizeLabel"
							@resize="geometry.resizeBy"
						/>
					</div> </DialogContent
			></UiTransition>
		</DialogPortal>
	</DialogRoot>
</template>

<style scoped>
	/* Reka 管理焦点、键盘、嵌套弹层及可访问 ID；此处只维护结构与主题变量。 */
	.ui-dialog-overlay {
		position: fixed;
		inset: 0;
		z-index: var(--ui-dialog-z-index, 100);
		background: var(--ui-dialog-overlay, #17152b55);
		backdrop-filter: var(--ui-dialog-overlay-filter, blur(7px));
	}
	.ui-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: var(--ui-dialog-z-index, 100);
		display: flex;
		flex-direction: column;
		width: min(var(--ui-dialog-width, var(--_ui-dialog-width, 560px)), calc(100vw - 32px));
		max-height: calc(100dvh - 48px);
		padding: 0;
		transform: translate(-50%, -50%);
		border: 1px solid var(--ui-dialog-border, var(--ui-border));
		border-radius: var(--ui-dialog-radius, 24px);
		background: var(--ui-dialog-background, var(--ui-surface));
		color: var(--ui-dialog-text, var(--ui-text));
		box-shadow: var(--ui-dialog-shadow, 0 28px 100px #18142f35);
	}
	.ui-dialog__surface {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		border-radius: inherit;
	}
	.ui-dialog[data-size='sm'] {
		--_ui-dialog-width: 360px;
	}
	.ui-dialog[data-size='lg'] {
		--_ui-dialog-width: 760px;
	}
	.ui-dialog[data-size='xl'] {
		--_ui-dialog-width: 960px;
	}
	.ui-dialog[data-size='fullscreen'] {
		inset: 0;
		width: 100%;
		height: 100dvh;
		max-height: none;
		border-radius: 0;
		transform: none;
	}
	.ui-dialog:focus {
		outline: none;
	}
	.ui-dialog__header {
		display: flex;
		flex-shrink: 0;
		align-items: flex-start;
		justify-content: space-between;
		gap: 18px;
		padding: var(--ui-dialog-padding, 26px) var(--ui-dialog-padding, 26px) 18px;
	}
	.ui-dialog__heading {
		min-width: 0;
	}
	.ui-dialog[data-draggable] .ui-dialog__header {
		cursor: grab;
		touch-action: none;
	}
	.ui-dialog[data-draggable] .ui-dialog__header:active {
		cursor: grabbing;
	}
	.ui-dialog__title {
		margin: 3px 0 0;
		font-size: var(--ui-dialog-title-font-size, 19px);
		font-weight: 650;
		line-height: 1.5;
		letter-spacing: -0.5px;
		overflow-wrap: anywhere;
	}
	.ui-dialog__description {
		margin: 8px 0 0;
		font-size: 12px;
		line-height: 1.8;
		color: var(--ui-muted);
		overflow-wrap: anywhere;
	}
	.ui-dialog__body {
		min-height: 0;
		padding: 0 var(--ui-dialog-padding, 26px) var(--ui-dialog-padding, 26px);
	}
	.ui-dialog[data-geometry] .ui-dialog__body {
		flex: 1 1 auto;
	}
	.ui-dialog__footer {
		display: flex;
		flex-shrink: 0;
		flex-wrap: wrap;
		gap: var(--ui-dialog-footer-gap, 12px);
		padding: 0 var(--ui-dialog-padding, 26px) var(--ui-dialog-padding, 26px);
	}
	.ui-dialog__footer > :deep(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	.ui-dialog__footer :deep([data-ui='button']) {
		--ui-button-height: var(--ui-dialog-action-height, 40px);
	}

	html[data-layout-profile='compact'] .ui-dialog {
		--ui-dialog-padding: 20px;
		max-height: calc(100dvh - 32px);
	}
	html[data-layout-profile='compact'] .ui-dialog[data-size='fullscreen'] {
		max-height: none;
	}
</style>
