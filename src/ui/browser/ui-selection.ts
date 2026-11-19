import type { ObjectDirective } from 'vue';

function selectedWithin(element: HTMLElement) {
	const selection = element.ownerDocument.getSelection();
	return (
		!!selection &&
		!selection.isCollapsed &&
		selection.rangeCount > 0 &&
		selection.toString().length > 0 &&
		selection.getRangeAt(0).intersectsNode(element)
	);
}

function beginSelection(event: PointerEvent) {
	if (event.button !== 0 || !event.isPrimary || event.shiftKey) return;
	const element = event.currentTarget as HTMLElement;
	// 原生按钮不会清除子正文的旧选区；新一轮左键/触摸开始时恢复普通点击语义。
	if (selectedWithin(element)) element.ownerDocument.getSelection()?.removeAllRanges();
}

function finishSelection(event: MouseEvent) {
	// detail 为 0 是键盘或程序触发，不把已有选区当成这一次的拖选。
	if (event.detail === 0 || !selectedWithin(event.currentTarget as HTMLElement)) return;
	event.preventDefault();
	event.stopImmediatePropagation();
}

/** 富内容操作区域：原生拖选/复制优先于点击；不接管剪贴板、右键或键盘激活。 */
export const vSelectableAction: ObjectDirective<HTMLElement> = {
	beforeMount(element) {
		element.addEventListener('pointerdown', beginSelection, true);
		element.addEventListener('click', finishSelection, true);
	},

	beforeUnmount(element) {
		element.removeEventListener('pointerdown', beginSelection, true);
		element.removeEventListener('click', finishSelection, true);
	},
};
