import { computed, shallowRef, watch, type Ref } from 'vue';
import { useStorage, useWindowSize } from '@vueuse/core';
import interact from 'interactjs';
import { z } from 'zod';
import { LayoutProfileSchema, resolveLayoutProfile } from '../../layout/layout-api.js';
import type { UiDialogProps } from './ui-component-types.js';
import { uiResizeEdges } from './ui-resize.js';

const DialogBoundsSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	width: z.number().positive().finite(),
	height: z.number().positive().finite(),
});
const DialogPlacementsSchema = z.partialRecord(LayoutProfileSchema, DialogBoundsSchema);

type Bounds = z.infer<typeof DialogBoundsSchema>;

/** 只管理弹窗几何，不读取 App Store；Reka 仍拥有挂载、焦点和关闭生命周期。 */
export function useDialogGeometry(
	props: Readonly<UiDialogProps>,
	open: Ref<boolean>,
	element: Readonly<Ref<HTMLElement | undefined>>,
	onStorageError: (cause: unknown) => void,
) {
	const { width, height } = useWindowSize({ includeScrollbar: false });
	const profile = computed(() => resolveLayoutProfile(width.value));
	const enabled = computed(() => props.size !== 'fullscreen' && !!(props.draggable || props.resizable));
	const bounds = shallowRef<Bounds>();
	const saved = useStorage<z.infer<typeof DialogPlacementsSchema>>(
		() => `nexus.ui.dialog.${props.persistenceKey ?? ''}`,
		{},
		undefined,
		{
			deep: false,
			writeDefaults: false,
			serializer: {
				read: (raw) => DialogPlacementsSchema.parse(JSON.parse(raw)),

				write: JSON.stringify,
			},
			onError: onStorageError,
		},
	);

	function fit(value: Bounds): Bounds {
		const maxWidth = Math.max(1, width.value - 32);
		const maxHeight = Math.max(1, height.value - 32);
		const w = Math.min(maxWidth, Math.max(Math.min(320, maxWidth), value.width));
		const h = Math.min(maxHeight, Math.max(Math.min(240, maxHeight), value.height));
		return {
			x: Math.max(16, Math.min(value.x, width.value - w - 16)),
			y: Math.max(16, Math.min(value.y, height.value - h - 16)),
			width: w,
			height: h,
		};
	}

	function remember() {
		if (!props.persistenceKey || !bounds.value) return;
		saved.value = { ...saved.value, [profile.value]: { ...bounds.value } };
	}

	function currentBounds(): Bounds | undefined {
		if (bounds.value) return fit(bounds.value);
		const rect = element.value?.getBoundingClientRect();
		if (!rect) return;
		return fit({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
	}

	function resize(w: number, h: number, leftDelta = 0, topDelta = 0) {
		const current = currentBounds();
		if (!current) return;
		const x = current.x + leftDelta;
		const y = current.y + topDelta;
		bounds.value = fit({
			...current,
			x,
			y,
			width: Math.min(w, width.value - x - 16),
			height: Math.min(h, height.value - y - 16),
		});
	}

	function resizeBy(widthDelta: number, heightDelta: number) {
		if (!enabled.value || !props.resizable) return;
		const current = currentBounds();
		if (!current) return;
		resize(current.width + widthDelta, current.height + heightDelta);
		remember();
	}

	watch(
		[
			element,
			open,
			enabled,
			() => props.persistenceKey,
			() => props.size,
			() => props.draggable,
			() => props.resizable,
			profile,
		],
		([node, visible, active], _, onCleanup) => {
			let interaction: ReturnType<typeof interact> | undefined;
			onCleanup(() => {
				interaction?.unset();
			});
			bounds.value = undefined;
			if (!node || !visible || !active) return;
			// 未操作且没有本地记录时保留 CSS 自然尺寸，异步加载和内容展开仍可撑高弹窗。
			// 第一次拖动/缩放才读取当前布局，避免记录入场动画中的缩放尺寸。
			bounds.value = (props.persistenceKey && saved.value[profile.value]) || undefined;
			interaction = interact(node)
				.draggable({
					enabled: !!props.draggable,
					allowFrom: '.ui-dialog__header',
					ignoreFrom: 'button, a, input, textarea, select, [contenteditable], [data-dialog-no-drag]',
					listeners: {
						move: (event) => {
							const current = currentBounds();
							if (!current) return;
							bounds.value = fit({
								...current,
								x: current.x + event.dx,
								y: current.y + event.dy,
							});
						},

						end: remember,
					},
				})
				.resizable({
					enabled: !!props.resizable,
					edges: uiResizeEdges,
					modifiers: [interact.modifiers.restrictSize({ min: { width: 320, height: 240 } })],
					listeners: {
						move: (event) =>
							resize(event.rect.width, event.rect.height, event.deltaRect.left, event.deltaRect.top),

						end: remember,
					},
				});
		},
		{ immediate: true, flush: 'post' },
	);
	// 视口裁剪只影响渲染；恢复视口时使用原尺寸，不覆盖本地记录。
	const visibleBounds = computed(() => bounds.value && fit(bounds.value));

	return {
		enabled,
		style: computed(() =>
			visibleBounds.value
				? {
						left: `${visibleBounds.value.x}px`,
						top: `${visibleBounds.value.y}px`,
						width: `${visibleBounds.value.width}px`,
						height: `${visibleBounds.value.height}px`,
						maxHeight: `${Math.max(1, height.value - 32)}px`,
						transform: 'none',
					}
				: undefined,
		),
		resizeBy,
	};
}
