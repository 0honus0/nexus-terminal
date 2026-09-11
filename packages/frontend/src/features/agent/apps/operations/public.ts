import { defineAsyncComponent } from 'vue';

export const OperationsAppView = defineAsyncComponent(() => import('./OperationsView.vue'));
