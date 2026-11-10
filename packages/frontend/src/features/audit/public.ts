export const loadAuditLogView = () => import('./views/AuditLogView.vue');

export { auditApi } from './api/audit-api';

import './composables/resetAuditCache';
