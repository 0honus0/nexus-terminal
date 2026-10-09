import type { ComputedRef, InjectionKey } from 'vue';

export type UiActionLayout = 'confirmation' | 'management' | 'batch' | 'card' | 'model';

export const actionLayoutKey: InjectionKey<ComputedRef<UiActionLayout>> = Symbol('ui-action-layout');
