import { useAuditStore } from '../store/audit.store';

export const resetAuditCache = (): void => useAuditStore().reset();
