import type { Component, InputTypeHTMLAttribute } from 'vue';

export type UiButtonAppearance = 'solid' | 'soft' | 'ghost' | 'glass';

/** Display-only data. Callers translate messages reactively and own retention. */
export interface UiToastItem {
	readonly id: string | number;
	readonly message: string;
	readonly tone: 'info' | 'success' | 'warning' | 'error';
}

export interface UiToastStackProps {
	items: readonly UiToastItem[];
	label: string;
	closeLabel: string;
	expandLabel: string;
	collapseLabel: string;
	/** Accessible position text, translated by the caller. Position 1 is newest. */
	positionLabel: (position: number, total: number) => string;
	duration?: number;
}

export type UiButtonTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

/** Shared sizing vocabulary for input, select and button controls. */
export type UiControlDensity = 'compact' | 'default' | 'comfortable' | 'touch';

export type UiButtonDensity = UiControlDensity;

export type UiButtonLoadingAnimation = 'icon' | 'spinner';

export interface UiButtonProps {
	appearance?: UiButtonAppearance;
	tone?: UiButtonTone;
	density?: UiButtonDensity;
	type?: 'button' | 'submit' | 'reset';
	disabled?: boolean;
	/** 加载时保留原内容占位及无障碍名称，禁止重复提交，不改变按钮尺寸。 */
	loading?: boolean;
	/**
	 * icon 旋转 leading 原图标，iconOnly 则旋转原内容；无图标时回退 spinner。
	 * spinner 在 leading 原位置显示圆圈并保留文字；纯图标或无 leading 时居中显示圆圈。
	 */
	loadingAnimation?: UiButtonLoadingAnimation;
	block?: boolean;
	/** 纯图标按钮须由调用方提供 aria-label 或 aria-labelledby。 */
	iconOnly?: boolean;
}

export interface UiSelectOption {
	value: string;
	label: string;
	disabled?: boolean;
}

export type UiSelectDensity = UiControlDensity;

export interface UiSelectProps {
	/** 文案由调用方按当前语言提供；value 使用稳定业务标识。 */
	options: readonly UiSelectOption[];
	placeholder?: string;
	name?: string;
	required?: boolean;
	disabled?: boolean;
	invalid?: boolean;
	block?: boolean;
	density?: UiSelectDensity;
	/** 弹层比选择框宽时默认向两侧等量展开；start / end 按阅读方向与边缘对齐。 */
	contentAlign?: 'start' | 'center' | 'end';
}

export type UiDialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';

/** 右下角隐藏缩放区域；只提供命中与键盘增量，不管理容器的尺寸及持久化。 */
export interface UiResizeHandleProps {
	/** 调用方提供本地化的可访问名称。 */
	label: string;
	/** 提供连续的外沿四边及角落命中区；容器须允许溢出，并单独裁剪内容。 */
	edges?: boolean;
}

export interface UiDialogProps {
	/** Nonmodal panels share host overlay state without blocking their application. */
	modal?: boolean;
	/** 必须提供可访问名称，不从业务内容猜测标题。 */
	title: string;
	description?: string;
	/** 调用方提供本地化的关闭按钮名称。 */
	closeLabel: string;
	size?: UiDialogSize;
	/** Presence motion for the panel. Bottom-aligned dialogs can use the sheet preset. */
	transitionPreset?: UiTransitionProps['preset'];
	showClose?: boolean;
	/** 暂时禁止用户关闭，保留关闭按钮的位置；宿主仍可主动更新 open。 */
	closeDisabled?: boolean;
	closeOnEscape?: boolean;
	closeOnInteractOutside?: boolean;
	/** 标题区域拖动；正文输入、按钮和滚动手势不参与拖动。全屏时禁用。 */
	draggable?: boolean;
	/** 默认启用边缘/角落缩放，可显式关闭；正文独立滚动。全屏时禁用。 */
	resizable?: boolean;
	/** 缩放手柄的本地化名称；手柄聚焦后也支持方向键调整大小。 */
	resizeLabel?: string;
	/** 稳定的业务标识。仅在当前浏览器按公共布局分档记忆位置、大小，不写入后端。 */
	persistenceKey?: string;
	/** Apply the same gutter to the fixed header/footer and scrolling body. */
	gutter?: UiScrollAreaProps['gutter'];
	/** 正文滚动条的可见性；隐藏时仍保留原生滚动。 */
	scrollbar?: UiScrollAreaProps['scrollbar'];
}

export interface UiActionCardProps {
	label: string;
	disabled?: boolean;
}

export interface UiMenuItem {
	id: string;
	label: string;
	icon?: Component;
	disabled?: boolean;
	tone?: 'neutral' | 'danger';
	/** Visually separate the following action group without creating a selectable row. */
	separatorBefore?: boolean;
}

export interface UiContextMenuProps {
	items: readonly UiMenuItem[];
	disabled?: boolean;
}

/** 原生输入属性和事件透传给 input；插槽只负责图标或附加按钮。 */
export interface UiInputProps {
	type?: InputTypeHTMLAttribute;
	disabled?: boolean;
	density?: UiControlDensity;
	invalid?: boolean;
}

export interface UiFieldProps {
	label: string;
	hint?: string;
	id?: string;
}

export interface UiSwitchProps {
	disabled?: boolean;
	name?: string;
	required?: boolean;
}

/** 单值滑条；update 用于预览，commit 用于确认，cancel 用于撤销预览。 */
export interface UiSliderProps {
	modelValue: number;
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	name?: string;
}

export interface UiTab {
	value: string;
	label: string;
	disabled?: boolean;
	icon?: Component;
}

export interface UiTabsProps {
	options: readonly UiTab[];
	label: string;
	defaultValue?: string;
	/** 共同占位避免切换跳高；隐藏页不参与焦点和交互。 */ stableHeight?: boolean;
}

/** 展示语义由调用方决定；组件不订阅或推导业务状态。 */
export interface UiBadgeProps {
	tone?: UiButtonTone;
	dot?: boolean;
}

/** 文案及图标由调用方提供，内部不绑定业务或语言。 */
export interface UiEmptyStateProps {
	title: string;
	description?: string;
	icon?: Component;
}

/** 通用条目卡片：主区域可点击；标签、右上标记和右下操作由插槽提供，不推导业务状态。 */
export interface UiCardProps {
	title: string;
	/** 主操作的无障碍名称；省略时由卡片内容生成。 */
	actionLabel?: string;
	description?: string;
	icon?: Component;
	tone?: UiButtonTone;
	disabled?: boolean;
}

/** 点击触发的动作菜单，与选择框和右键菜单互斥；业务只接收稳定的选项 ID。 */
export interface UiDropdownMenuProps {
	items: readonly UiMenuItem[];
	disabled?: boolean;
	align?: 'start' | 'center' | 'end';
	/** 默认直接展开。 */
	transition?: 'none' | 'fade';
}

/** 通用静态列表项，业务操作放在 actions 插槽，不将整行伪装成按钮。 */
export interface UiListItemProps {
	title: string;
	description?: string;
	icon?: Component;
}

/** 原生滚动条容器；不模拟滚动，也不添加业务布局或文案。 */
export interface UiScrollAreaProps {
	/** 将样式和属性交给唯一子元素，保留现有 DOM、语义与事件，不增加包装层。 */
	asChild?: boolean;
	/** auto 按需占位；stable 固定单侧占位；symmetric 对称占位，适合居中弹窗。 */
	gutter?: 'auto' | 'stable' | 'symmetric';
	/** hidden 用于与滚动正文对齐的固定标题和页脚，共用同一 gutter 规则。 */
	overflow?: 'auto' | 'hidden';
	/** hidden 只隐藏滚动条，不禁用鼠标、触摸或键盘滚动，也不保留滚动条占位。 */
	scrollbar?: 'auto' | 'hidden';
}

/** Pure layout: business state and translated content belong to the caller. */
export interface UiSectionProps {
	title?: string;
	description?: string;
	icon?: Component;
	appearance?: 'plain' | 'panel';
	/** 提供带展开状态的标题栏按钮；内容保持挂载，默认展开，可通过 v-model:open 控制。 */
	collapsible?: boolean;
}

export interface UiFormRowProps {
	label: string;
	description?: string;
	icon?: Component;
	id?: string;
}

export interface UiProgressProps {
	label: string;
	/** Omit for indeterminate work; explicit zero remains determinate. */
	value?: number;
}

export type UiProgressState = 'pending' | 'running' | 'succeeded' | 'failed';

export interface UiProgressRowProps {
	density?: 'default' | 'compact';
	/** 默认显示横向进度条；关闭时保留状态图标、名称及百分比。 */
	showProgress?: boolean;
	/** percent 显示可计量进度；label 用状态文字表示不可计量的工作，不推算百分比。 */
	statusDisplay?: 'percent' | 'label';
	label: string;
	state: UiProgressState;
	statusLabel: string;
	value?: number;
}

/** Shared transform/opacity presence transition, using host motion preferences. */
export interface UiTransitionProps {
	preset?: 'none' | 'fade' | 'drop' | 'panel' | 'sheet' | 'context-menu';
	appear?: boolean;
}

export interface UiLoadingTilesProps {
	/** 已翻译的加载提示。使用 caption 插槽时由调用方提供可访问状态。 */
	label?: string;
	icons?: readonly Component[];
	/** 静态显示方块时关闭动画。宿主的减少动态效果设置始终生效。 */
	active?: boolean;
}
