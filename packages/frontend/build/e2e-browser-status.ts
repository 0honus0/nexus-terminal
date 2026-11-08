// Native Chart.js rendering remains a browser assertion, using the production component.
export { createApp, h, nextTick } from 'vue';

export { Chart } from 'chart.js';

export { default as StatusCharts } from '../src/features/status-monitor/components/StatusCharts.vue';

export { default as i18n, setLocale } from '../src/app/i18n';
