import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { useAuditStore } from '../store/audit.store';

export const resetAuditCache = (): void => useAuditStore().reset();

registerAuthenticatedSessionReset('audit-cache', resetAuditCache);
