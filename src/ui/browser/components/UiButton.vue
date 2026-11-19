<script setup lang="ts">
	import type { UiButtonProps } from '../ui-component-types.js';

	import type { VNodeChild } from 'vue';

	const props = withDefaults(defineProps<UiButtonProps>(), {
		appearance: 'soft',
		tone: 'neutral',
		density: 'default',
		type: 'button',
		disabled: false,
		loading: false,
		loadingAnimation: 'icon',
		block: false,
		iconOnly: false,
	});

	const slots = defineSlots<{
		default?: () => VNodeChild;
		leading?: () => VNodeChild;
		trailing?: () => VNodeChild;
	}>();

	function animateIcon() {
		return props.loadingAnimation === 'icon' && (props.iconOnly || !!slots.leading);
	}

	function spinnerPlacement() {
		return !props.iconOnly && slots.leading ? 'leading' : 'content';
	}
</script>

<template>
	<button
		data-ui="button"
		:data-appearance="props.appearance"
		:data-tone="props.tone"
		:data-density="props.density"
		:type="props.type"
		:disabled="props.disabled || props.loading"
		:aria-busy="props.loading || undefined"
		:data-loading-animation="props.loading ? (animateIcon() ? 'icon' : 'spinner') : undefined"
		:data-loading-placement="props.loading && !animateIcon() ? spinnerPlacement() : undefined"
		class="ui-button"
		:class="{
			'ui-button--block': props.block,
			'ui-button--icon-only': props.iconOnly,
		}"
	>
		<span class="ui-button__content">
			<span v-if="$slots.leading" class="ui-button__leading">
				<span class="ui-button__leading-content"><slot name="leading" /></span>
				<span
					v-if="props.loading && !animateIcon() && spinnerPlacement() === 'leading'"
					class="ui-button__loader"
					aria-hidden="true"
				>
					<span class="ui-button__spinner"></span>
				</span>
			</span>
			<slot />
			<slot name="trailing" />
		</span>
		<span
			v-if="props.loading && !animateIcon() && spinnerPlacement() === 'content'"
			class="ui-button__loader"
			aria-hidden="true"
		>
			<span class="ui-button__spinner"></span>
		</span>
	</button>
</template>

<style scoped>
	/*
	 * 移植旧版按钮的尺寸、玻璃材质、语义色及状态，不依赖旧全局 CSS 或按钮组注入。
	 * --ui-* 是允许主题覆盖的变量；--_ui-button-* 仅用于组件内部计算默认值。
	 * 不在按钮节点声明公共变量的默认值，以免遮住从 UI 根作用域继承的主题覆盖。
	 * 保持与全局主题相同的优先级，显式主题模式覆盖系统模式。
	 */
	.ui-button {
		--_ui-button-page: var(--ui-background, #ffffff);
		--_ui-button-surface: var(--ui-surface, rgb(246 247 249 / 92%));
		--_ui-button-text: var(--ui-text, #333333);
		--_ui-button-border: var(--ui-border, #a3acb9);
		--_ui-button-disabled-fill: var(--ui-disabled-background, #f3f4f6);
		--_ui-button-disabled-text: var(--ui-disabled-text, #6b7280);
		--_ui-button-disabled-border: var(--ui-disabled-border, #d1d5db);
		--_ui-button-rim: color-mix(in srgb, var(--_ui-button-page) 85%, #ffffff);
		--_ui-button-highlight: inset 0 1px 0 color-mix(in srgb, var(--_ui-button-rim) 8%, transparent);
		--_ui-button-ink: var(--_ui-button-text);
		--_ui-button-fill: color-mix(in srgb, var(--_ui-button-surface) 28%, transparent);
		--_ui-button-fill-hover: color-mix(in srgb, var(--_ui-button-surface) 42%, transparent);
		--_ui-button-fill-active: color-mix(in srgb, var(--_ui-button-surface) 68%, transparent);
		--_ui-button-edge: color-mix(in srgb, var(--_ui-button-border) 80%, transparent);
		--_ui-button-edge-hover: color-mix(in srgb, var(--_ui-button-border) 92%, transparent);
		--_ui-button-filter: blur(16px) saturate(170%);
		--_ui-button-sheen: radial-gradient(
			95% 75% at 50% -28%,
			color-mix(in srgb, var(--_ui-button-rim) 16%, transparent),
			transparent 85%
		);
		--_ui-button-shadow: var(--_ui-button-highlight), 0 1px 2px rgb(0 0 0 / 5%), 0 8px 18px -14px rgb(0 0 0 / 22%);
		--_ui-button-shadow-hover:
			inset 0 1px 0 color-mix(in srgb, var(--_ui-button-rim) 60%, transparent), 0 2px 4px rgb(0 0 0 / 7%),
			0 12px 22px -14px rgb(0 0 0 / 28%);
		--_ui-button-shadow-active: inset 0 1px 2px rgb(0 0 0 / 10%), 0 1px 3px rgb(0 0 0 / 7%);

		box-sizing: border-box;
		position: relative;
		display: inline-flex;
		min-width: var(--ui-button-height, var(--ui-control-height, var(--_ui-control-height, 36px)));
		min-height: var(--ui-button-height, var(--ui-control-height, var(--_ui-control-height, 36px)));
		height: var(--ui-button-height, var(--ui-control-height, var(--_ui-control-height, 36px)));
		align-items: center;
		justify-content: center;
		gap: var(--ui-button-gap, var(--ui-control-gap, var(--_ui-control-gap, 8px)));
		margin: 0;
		padding-block: 0;
		padding-inline: var(
			--ui-button-padding-inline,
			var(--ui-control-padding-inline, var(--_ui-control-padding-inline, 11px))
		);
		border: 1px solid var(--ui-button-border, var(--_ui-button-edge));
		border-radius: var(--ui-button-radius, var(--ui-control-radius, var(--ui-radius, 10px)));
		background-color: var(--ui-button-background, var(--_ui-button-fill));
		background-image: var(--ui-button-background-image, var(--_ui-button-sheen));
		color: var(--ui-button-text, var(--_ui-button-ink));
		font-family: var(--ui-font-family, inherit);
		font-size: var(--ui-button-font-size, var(--ui-control-font-size, var(--_ui-control-font-size, 13px)));
		font-weight: var(--ui-button-font-weight, 560);
		line-height: 1;
		white-space: nowrap;
		box-shadow: var(--ui-button-shadow, var(--ui-shadow, var(--_ui-button-shadow)));
		-webkit-backdrop-filter: var(--ui-button-backdrop-filter, var(--ui-backdrop-filter, var(--_ui-button-filter)));
		backdrop-filter: var(--ui-button-backdrop-filter, var(--ui-backdrop-filter, var(--_ui-button-filter)));
		appearance: none;
		cursor: pointer;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
		transition:
			background-color var(--ui-motion-duration, 140ms) var(--ui-motion-ease, cubic-bezier(0.2, 0.8, 0.2, 1)),
			border-color var(--ui-motion-duration, 140ms) var(--ui-motion-ease, cubic-bezier(0.2, 0.8, 0.2, 1)),
			color var(--ui-motion-duration, 140ms) var(--ui-motion-ease, cubic-bezier(0.2, 0.8, 0.2, 1)),
			box-shadow var(--ui-motion-duration, 140ms) var(--ui-motion-ease, cubic-bezier(0.2, 0.8, 0.2, 1));
	}

	:where([data-ui-mode='dark']:not([data-ui-theme-mode='light']), [data-ui-theme-mode='dark']) .ui-button,
	.ui-button:where([data-ui-mode='dark']:not([data-ui-theme-mode='light']), [data-ui-theme-mode='dark']) {
		--_ui-button-page: var(--ui-background, #212529);
		--_ui-button-surface: var(--ui-surface, rgb(43 48 53 / 90%));
		--_ui-button-text: var(--ui-text, #e9ecef);
		--_ui-button-border: var(--ui-border, #495057);
		--_ui-button-disabled-fill: var(--ui-disabled-background, #343a40);
		--_ui-button-disabled-text: var(--ui-disabled-text, #adb5bd);
		--_ui-button-disabled-border: var(--ui-disabled-border, #495057);
	}

	.ui-button--block {
		width: 100%;
	}

	.ui-button--icon-only {
		width: var(--ui-button-height, var(--ui-control-height, var(--_ui-control-height, 36px)));
		padding-inline: 0;
	}

	.ui-button[data-appearance='solid'] {
		--_ui-button-fill: color-mix(in srgb, var(--_ui-button-surface) 52%, transparent);
		--_ui-button-fill-hover: color-mix(in srgb, var(--_ui-button-surface) 64%, transparent);
	}

	.ui-button[data-appearance='glass'] {
		--_ui-button-fill: color-mix(in srgb, var(--_ui-button-surface) 42%, transparent);
		--_ui-button-fill-hover: color-mix(in srgb, var(--_ui-button-surface) 54%, transparent);
		--_ui-button-sheen: linear-gradient(
			135deg,
			color-mix(in srgb, var(--_ui-button-rim) 14%, transparent) 0%,
			transparent 38%,
			transparent 100%
		);
		--_ui-button-shadow:
			var(--_ui-button-highlight), inset 1px 0 0 color-mix(in srgb, var(--_ui-button-rim) 5%, transparent),
			inset -1px 0 0 color-mix(in srgb, var(--_ui-button-rim) 3%, transparent), 0 1px 2px rgb(0 0 0 / 6%),
			0 24px 56px -26px rgb(0 0 0 / 24%);
		--_ui-button-filter: blur(14px) saturate(155%);
	}

	.ui-button[data-tone='danger'] {
		--_ui-button-accent: var(--ui-danger, #dc3545);
	}

	.ui-button[data-tone='success'] {
		--_ui-button-accent: var(--ui-success, #28a745);
	}

	.ui-button[data-tone='warning'] {
		--_ui-button-accent: var(--ui-warning, #ffc107);
	}

	.ui-button:is([data-tone='danger'], [data-tone='success'], [data-tone='warning']) {
		--_ui-button-ink: var(--_ui-button-accent);
		--_ui-button-fill: color-mix(in srgb, var(--_ui-button-accent) 10%, transparent);
		--_ui-button-fill-hover: color-mix(in srgb, var(--_ui-button-accent) 17%, transparent);
		--_ui-button-edge: color-mix(in srgb, var(--_ui-button-accent) 35%, var(--_ui-button-border));
		--_ui-button-edge-hover: color-mix(in srgb, var(--_ui-button-accent) 55%, var(--_ui-button-border));
	}

	.ui-button[data-tone='primary'] {
		--_ui-button-highlight: 0 0 0 transparent;
		--_ui-button-shadow-hover: 0 2px 4px rgb(0 0 0 / 7%), 0 12px 22px -14px rgb(0 0 0 / 28%);
	}

	/* 与旧版一致：primary 的 soft/glass 保持安静外观，solid 使用主题主色。 */
	.ui-button[data-appearance='solid'][data-tone='primary'] {
		--_ui-button-fill: var(--ui-primary, #a06cd5);
		--_ui-button-fill-hover: var(--ui-primary-hover, #8e44ad);
		--_ui-button-fill-active: var(--ui-primary-hover, #8e44ad);
		--_ui-button-ink: var(--ui-primary-text, #ffffff);
		--_ui-button-edge: color-mix(in srgb, var(--ui-primary-hover, #8e44ad) 55%, var(--ui-primary, #a06cd5));
		--_ui-button-edge-hover: var(--ui-primary-hover, #8e44ad);
		--_ui-button-sheen: none;
		--_ui-button-shadow:
			0 1px 2px rgb(0 0 0 / 8%), 0 10px 20px -14px color-mix(in srgb, var(--ui-primary, #a06cd5) 55%, transparent);
		--_ui-button-shadow-hover:
			0 2px 4px rgb(0 0 0 / 7%), 0 12px 22px -14px color-mix(in srgb, var(--ui-primary, #a06cd5) 55%, transparent);
	}

	.ui-button[data-appearance='ghost'] {
		--_ui-button-fill: transparent;
		--_ui-button-fill-hover: color-mix(in srgb, var(--_ui-button-text) 6%, transparent);
		--_ui-button-fill-active: color-mix(in srgb, var(--_ui-button-text) 9%, transparent);
		--_ui-button-edge: transparent;
		--_ui-button-edge-hover: transparent;
		--_ui-button-sheen: none;
		--_ui-button-shadow: none;
		--_ui-button-shadow-hover: none;
		--_ui-button-shadow-active: none;
		--_ui-button-filter: none;
	}

	.ui-button:not(:disabled):hover {
		background-color: var(--ui-button-hover-background, var(--ui-button-background, var(--_ui-button-fill-hover)));
		border-color: var(--ui-button-hover-border, var(--ui-button-border, var(--_ui-button-edge-hover)));
		box-shadow: var(
			--ui-button-hover-shadow,
			var(--ui-button-shadow, var(--ui-shadow, var(--_ui-button-shadow-hover)))
		);
	}

	.ui-button:not(:disabled):active {
		background-color: var(
			--ui-button-active-background,
			var(--ui-button-background, var(--_ui-button-fill-active))
		);
		box-shadow: var(
			--ui-button-active-shadow,
			var(--ui-button-shadow, var(--ui-shadow, var(--_ui-button-shadow-active)))
		);
	}

	.ui-button:not(:disabled):focus-visible {
		outline: 2px solid var(--ui-button-focus-color, var(--ui-focus-color, var(--ui-primary, #a06cd5)));
		outline-offset: 2px;
		box-shadow: var(--ui-button-focus-shadow, var(--ui-focus-ring, 0 0 0 3px rgb(160 108 213 / 18%)));
	}

	.ui-button:disabled:not([aria-busy='true']) {
		cursor: not-allowed;
		border-color: var(--ui-button-disabled-border, var(--_ui-button-disabled-border));
		background-color: var(
			--ui-button-disabled-background,
			color-mix(in srgb, var(--_ui-button-disabled-fill) 58%, transparent)
		);
		background-image: none;
		color: var(--ui-button-disabled-text, var(--_ui-button-disabled-text));
		box-shadow: none;
		opacity: var(--ui-button-disabled-opacity, 1);
		-webkit-backdrop-filter: var(--ui-button-disabled-backdrop-filter, blur(8px));
		backdrop-filter: var(--ui-button-disabled-backdrop-filter, blur(8px));
	}

	.ui-button__content {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: inherit;
	}

	.ui-button[aria-busy='true'] {
		cursor: progress;
	}

	.ui-button__leading,
	.ui-button__leading-content {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
	.ui-button__leading {
		position: relative;
	}

	.ui-button[data-loading-placement='content'] .ui-button__content,
	.ui-button[data-loading-placement='leading'] .ui-button__leading-content {
		/* opacity 保留布局及无障碍名称，所有插槽在加载期间仍保持挂载。 */
		opacity: 0;
	}

	.ui-button__loader {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	.ui-button__spinner {
		box-sizing: border-box;
		width: 1em;
		height: 1em;
		flex: none;
		border: max(1.5px, calc(1em * 0.1)) solid color-mix(in srgb, currentColor 16%, transparent);
		border-top-color: currentColor;
		border-right-color: color-mix(in srgb, currentColor 58%, transparent);
		border-radius: 50%;
		box-shadow: 0 0 6px color-mix(in srgb, currentColor 14%, transparent);
		animation: ui-button-spin 820ms linear infinite;
	}

	.ui-button[data-loading-animation='icon']:not(.ui-button--icon-only) .ui-button__leading,
	.ui-button--icon-only[data-loading-animation='icon'] .ui-button__content {
		animation: ui-button-spin 820ms linear infinite;
	}

	@keyframes ui-button-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ui-button {
			transition: none;
		}

		.ui-button__spinner,
		.ui-button__leading,
		.ui-button__content {
			animation: none;
		}
	}

	@media (forced-colors: active) {
		.ui-button {
			border-color: ButtonText;
			background: ButtonFace;
			color: ButtonText;
			box-shadow: none;
		}

		.ui-button:disabled {
			border-color: GrayText;
			color: GrayText;
		}

		.ui-button:not(:disabled):focus-visible {
			outline-color: Highlight;
			box-shadow: none;
		}
	}
</style>
