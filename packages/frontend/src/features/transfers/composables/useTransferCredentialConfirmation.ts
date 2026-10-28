import { useI18n } from 'vue-i18n';
import { booleanStorageCodec, readStoredValue, writeStoredValue } from '@/foundation/browser';
import { useFeedback } from '@/shared/feedback/public';
import { authenticatedSessionLifecycle } from '@/shared/session/public';

export function useTransferCredentialConfirmation(): (signal: AbortSignal) => Promise<boolean> {
	const feedback = useFeedback();
	const { t } = useI18n();

	return async (signal) => {
		const userId = authenticatedSessionLifecycle.userId;
		if (signal.aborted || userId === null) return false;
		const preference = {
			namespace: 'transfers.skip-credential-warning',
			version: 1,
			scope: { kind: 'user', id: userId } as const,
			codec: booleanStorageCodec,
		};
		if (readStoredValue(preference) === true) return true;
		let skipNextTime = false;
		const accepted = await feedback.confirm({
			message: t('sendFilesModal.credentialTrustWarning'),
			destructive: true,
			signal,
			checkbox: {
				label: t('sendFilesModal.doNotRemindAgain'),

				onChange: (checked) => {
					skipNextTime = checked;
				},
			},
		});
		if (signal.aborted || authenticatedSessionLifecycle.userId !== userId) return false;
		if (accepted && skipNextTime) writeStoredValue(preference, true);
		return accepted;
	};
}
