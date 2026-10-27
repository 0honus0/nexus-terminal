/** Authentication, credentials and live sessions always remain owned by the receiving instance. */
export function accessBackupExclusions(): readonly string[] {
	return [
		'access_accounts',
		'access_sessions',
		'access_login_attempts',
		'access_password_epoch',
		'access_pending_logins',
		'access_factor_challenges',
		'access_passkeys',
	];
}
