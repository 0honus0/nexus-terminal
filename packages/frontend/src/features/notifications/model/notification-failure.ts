import { OperationsRequestFailure } from '@/client/operations/operations-request';

export function notificationFailureKey(cause: unknown): string {
	if (!(cause instanceof OperationsRequestFailure) || cause.outcome === 'unknown') {
		return 'settings.notifications.unknown';
	}
	if (cause.code === 'version_conflict' || cause.code === 'not_found') {
		return 'settings.notifications.conflict';
	}
	if (cause.code === 'refresh_required') {
		return 'settings.notifications.refreshRequired';
	}
	if (cause.code === 'invalid_input' || cause.code === 'limit_exceeded') {
		return 'settings.notifications.invalid';
	}
	return 'settings.notifications.failure';
}
