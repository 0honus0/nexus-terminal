import type { ComputedRef, InjectionKey } from 'vue';

export type UiActionLayout = 'confirmation' | 'batch';

export const actionLayoutKey: InjectionKey<ComputedRef<UiActionLayout>> = Symbol('ui-action-layout');
