import { onScopeDispose, watch, type Ref } from 'vue';

interface TransientOverlay {
	dismiss(): void;
}
let active: TransientOverlay | undefined;

/** 本体共享 UI 实例内仅保留一个临时弹层；模态弹窗仍由 Reka 维护嵌套与焦点栈。 */
export function dismissTransientOverlay() {
	active?.dismiss();
}

export function useTransientOverlay(open: Ref<boolean>) {
	let restoreFocus = true;
	const overlay: TransientOverlay = {
		dismiss() {
			restoreFocus = false;
			open.value = false;
		},
	};
	watch(
		open,
		(value) => {
			if (value) {
				if (active !== overlay) active?.dismiss();
				restoreFocus = true;
				active = overlay;
			} else if (active === overlay) active = undefined;
		},
		{ immediate: true, flush: 'sync' },
	);
	onScopeDispose(() => {
		if (active === overlay) active = undefined;
	});
	return {
		interactOutside() {
			restoreFocus = false;
		},

		closeAutoFocus(event: Event) {
			if (!restoreFocus) event.preventDefault();
		},

		/** 先收起菜单并把焦点交回触发器，再执行动作；新弹窗接管焦点后，旧菜单不能抢回。 */
		select(trigger: HTMLElement | SVGElement | null | undefined, action: () => void) {
			overlay.dismiss();
			trigger?.focus({ preventScroll: true });
			action();
		},
	};
}
