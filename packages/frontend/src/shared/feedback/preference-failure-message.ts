import { PreferenceRequestFailure } from '@/client/preferences/preference-request';

export function preferenceFailureMessage(cause: unknown, translate: (key: string) => string): string {
	if (!(cause instanceof PreferenceRequestFailure)) {
		return translate('common.personalDataFailure');
	}
	if (cause.outcome === 'unknown' || cause.code === 'operation_unknown') {
		return translate('common.personalDataUnknown');
	}
	if (cause.code === 'version_conflict' || cause.code === 'not_found' || cause.code === 'refresh_required') {
		return translate('common.personalDataConflict');
	}
	if (cause.code === 'invalid_input' || cause.code === 'limit_exceeded') {
		return translate('common.personalDataInvalid');
	}
	return translate('common.personalDataFailure');
}
