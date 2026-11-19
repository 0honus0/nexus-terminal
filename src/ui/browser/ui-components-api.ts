/**
 * 固定基础组件入口；按需求逐个调整组件，并在 tests/components 维护对应的 Vue 展示页。
 * 直接导出 Vue 组件及其自身类型，不建立组件注册表或动态代理。
 */
export { UiButton, UiField, UiInput, UiSelect, UiToastStack } from './ui-base-api.js';

export { default as UiDialog } from './components/UiDialog.vue';

export { default as UiTransition } from './components/UiTransition.vue';

export { default as UiResizeHandle } from './components/UiResizeHandle.vue';

export { uiResizeEdges } from './ui-resize.js';

export { vSelectableAction } from './ui-selection.js';

export { default as UiActionCard } from './components/UiActionCard.vue';

export { default as UiContextMenu } from './components/UiContextMenu.vue';

export { default as UiSwitch } from './components/UiSwitch.vue';

export { default as UiSlider } from './components/UiSlider.vue';

export { default as UiTabs } from './components/UiTabs.vue';

export { default as UiBadge } from './components/UiBadge.vue';

export { default as UiEmptyState } from './components/UiEmptyState.vue';

export { default as UiCard } from './components/UiCard.vue';

export { default as UiDropdownMenu } from './components/UiDropdownMenu.vue';

export { default as UiList } from './components/UiList.vue';

export { default as UiListItem } from './components/UiListItem.vue';

export { default as UiScrollArea } from './components/UiScrollArea.vue';

export { default as UiSection } from './components/UiSection.vue';

export { default as UiFormRow } from './components/UiFormRow.vue';

export { default as UiToolbar } from './components/UiToolbar.vue';

export { default as UiProgress } from './components/UiProgress.vue';

export { default as UiProgressRow } from './components/UiProgressRow.vue';
