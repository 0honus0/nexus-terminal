<script setup lang="ts">
	import { computed } from 'vue';
	import { useUiMotion } from '../ui-motion-api.js';
	import { useTransientOverlay } from '../ui-overlay.js';
	import type { UiSelectProps } from '../ui-component-types.js';
	import {
		SelectContent,
		SelectIcon,
		SelectItem,
		SelectItemText,
		SelectPortal,
		SelectRoot,
		SelectScrollDownButton,
		SelectScrollUpButton,
		SelectTrigger,
		SelectValue,
		SelectViewport,
	} from 'reka-ui';
	import { ChevronDown, ChevronUp } from '@lucide/vue';
	defineOptions({ inheritAttrs: false });
	const value = defineModel<string>();
	const open = defineModel<boolean>('open', { default: false });
	const overlay = useTransientOverlay(open);
	const { play } = useUiMotion();
	const visibleClip = 'inset(-48px)';
	const props = withDefaults(defineProps<UiSelectProps>(), {
		density: 'default',
		required: false,
		disabled: false,
		invalid: false,
		block: false,
		contentAlign: 'center',
	});
	// 选项弹层装卸会暂时清空 Reka 的选项登记；触发器文字由稳定的数据源提供。
	const selectedLabel = computed(
		() => props.options.find((option) => option.value === value.value)?.label ?? props.placeholder ?? '',
	);
	let pendingContent: HTMLElement | null = null;

	function beforeEnter(wrapper: Element) {
		pendingContent = wrapper.querySelector<HTMLElement>('[data-ui="select-content"]');
		pendingContent?.setAttribute('data-positioning', '');
	}

	function placed() {
		if (!open.value || !pendingContent) return;
		const content = pendingContent;
		pendingContent = null;
		// Reka moves the wrapper into place before emitting placed. Animate only the content.
		content.removeAttribute('data-positioning');
		const openingClip = content.dataset.side === 'top' ? 'inset(18px -48px -48px)' : 'inset(-48px -48px 18px)';
		play(
			content,
			[
				{ opacity: 0, clipPath: openingClip },
				{ opacity: 1, clipPath: visibleClip },
			],
			150,
		);
	}

	function leave(wrapper: Element, done: () => void) {
		const content = wrapper.querySelector<HTMLElement>('[data-ui="select-content"]');
		if (!content || content === pendingContent) {
			pendingContent = null;
			done();
			return;
		}
		wrapper.setAttribute('inert', '');
		wrapper.setAttribute('aria-hidden', 'true');
		play(
			content,
			[
				{ opacity: 1, clipPath: visibleClip },
				{ opacity: 0, clipPath: visibleClip },
			],
			90,
			done,
		);
	}
</script>

<template>
	<SelectRoot
		v-model="value"
		v-model:open="open"
		:name="props.name"
		:required="props.required"
		:disabled="props.disabled || props.options.length === 0"
	>
		<SelectTrigger
			v-bind="$attrs"
			data-ui="select"
			:data-density="props.density"
			:aria-invalid="props.invalid || undefined"
			class="ui-select"
			:class="{ 'ui-select--block': props.block }"
		>
			<SelectValue class="ui-select__value" :placeholder="props.placeholder">{{ selectedLabel }}</SelectValue>
			<SelectIcon class="ui-select__icon"><ChevronDown :size="15" /></SelectIcon>
		</SelectTrigger>
		<SelectPortal v-if="props.options.length">
			<Transition appear :css="false" @before-enter="beforeEnter" @leave="leave">
				<SelectContent
					v-if="open"
					force-mount
					data-ui="select-content"
					class="ui-select-content"
					position="popper"
					:body-lock="false"
					:disable-outside-pointer-events="false"
					@placed="placed"
					@pointer-down-outside="overlay.interactOutside"
					@close-auto-focus="overlay.closeAutoFocus"
					:align="props.contentAlign"
					:side-offset="6"
					:collision-padding="12"
				>
					<SelectScrollUpButton class="ui-select-scroll"><ChevronUp :size="15" /></SelectScrollUpButton>
					<SelectViewport class="ui-select-viewport">
						<SelectItem
							v-for="option in props.options"
							:key="option.value"
							:value="option.value"
							:disabled="option.disabled"
							class="ui-select-option"
						>
							<!-- 当前值由上方选择框展示；选中语义与键盘高亮由 Reka 保留。 -->
							<SelectItemText class="ui-select-option__label">{{ option.label }}</SelectItemText>
						</SelectItem>
					</SelectViewport>
					<SelectScrollDownButton class="ui-select-scroll"><ChevronDown :size="15" /></SelectScrollDownButton>
				</SelectContent>
			</Transition>
		</SelectPortal>
	</SelectRoot>
</template>

<style scoped>
	/* Reka 负责焦点、键盘、原生表单值和弹层定位；主题只覆盖 --ui-* 变量。 */
	.ui-select {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--ui-control-gap, var(--_ui-control-gap, 8px));
		min-width: 0;
		max-width: 100%;
		height: var(--ui-select-height, var(--ui-control-height, var(--_ui-control-height, 36px)));
		padding: 0 var(--ui-control-padding-inline, var(--_ui-control-padding-inline, 11px));
		border: 1px solid var(--ui-select-border, var(--ui-border, #eae7f0));
		border-radius: var(--ui-select-radius, var(--ui-control-radius, 9px));
		background: var(--ui-select-background, var(--ui-surface, #fff));
		color: var(--ui-select-text, var(--ui-text, #302d40));
		font-family: var(--ui-font-family, inherit);
		font-size: var(--ui-select-font-size, var(--ui-control-font-size, var(--_ui-control-font-size, 13px)));
		font-weight: inherit;
		line-height: 1.5;
		text-align: start;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
		caret-color: transparent;
		transition:
			border-color var(--ui-motion-duration, 140ms) ease,
			box-shadow var(--ui-motion-duration, 140ms) ease;
	}
	.ui-select--block {
		width: 100%;
	}
	.ui-select__value {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ui-select__icon {
		display: flex;
		flex: none;
		color: var(--ui-muted, #8b879a);
	}
	.ui-select[data-placeholder] {
		color: var(--ui-muted, #8b879a);
	}
	.ui-select:not(:disabled):hover,
	.ui-select[data-state='open'] {
		border-color: var(--ui-primary, #8b63d3);
	}
	.ui-select:focus-visible {
		outline: 2px solid var(--ui-primary, #8b63d3);
		outline-offset: 2px;
	}
	.ui-select[aria-invalid='true'] {
		border-color: var(--ui-danger, #ca5468);
	}
	.ui-select:disabled {
		cursor: not-allowed;
		opacity: var(--ui-disabled-opacity, 0.55);
	}
	/* SelectContent 的多层透传不保留父级 scope 属性，弹层用唯一全局类名定位。 */
	:global(.ui-select-content) {
		z-index: var(--ui-select-z-index, 110);
		width: max-content;
		min-width: var(--reka-select-trigger-width);
		max-width: min(calc(100vw - 24px), var(--reka-select-content-available-width));
		max-height: min(320px, var(--reka-select-content-available-height));
		overflow: hidden;
		border: 1px solid var(--ui-select-border, var(--ui-border, #eae7f0));
		border-radius: var(--ui-select-menu-radius, 12px);
		background: var(--ui-select-menu-background, var(--ui-surface, #fff));
		color: var(--ui-select-text, var(--ui-text, #302d40));
		font-family: var(--ui-font-family, inherit);
		font-size: var(--ui-select-option-font-size, 13px);
		box-shadow: var(--ui-select-shadow, 0 12px 36px #17132d24);
		user-select: none;
		-webkit-user-select: none;
		caret-color: transparent;
	}
	:global(.ui-select-content[data-positioning]) {
		opacity: 0;
	}
	.ui-select-viewport {
		padding: 5px;
	}
	.ui-select-option {
		position: relative;
		display: flex;
		align-items: center;
		min-height: var(--ui-select-option-height, 36px);
		padding: 7px 10px;
		border-radius: 7px;
		outline: none;
		cursor: pointer;
		user-select: none;
	}
	.ui-select-option__label {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.ui-select-option[data-highlighted] {
		background: color-mix(in srgb, var(--ui-primary, #8b63d3) 12%, transparent);
	}
	.ui-select-option[data-disabled] {
		color: var(--ui-muted, #8b879a);
		opacity: var(--ui-disabled-opacity, 0.55);
		cursor: not-allowed;
	}
	.ui-select-scroll {
		display: flex;
		justify-content: center;
		align-items: center;
		height: 24px;
		color: var(--ui-muted, #8b879a);
	}
	@media (pointer: coarse) {
		.ui-select-option {
			min-height: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ui-select {
			transition: none;
		}
	}
	@media (forced-colors: active) {
		.ui-select,
		:global(.ui-select-content) {
			background: Canvas;
			color: CanvasText;
			border-color: ButtonText;
			box-shadow: none;
		}
		.ui-select-option[data-highlighted] {
			outline: 1px solid Highlight;
		}
	}
</style>
