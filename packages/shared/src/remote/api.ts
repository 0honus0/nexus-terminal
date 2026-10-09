export interface RemoteFailureResponse {
	code: 'unauthenticated' | 'forbidden' | 'invalid_input' | 'not_found' | 'host_key_untrusted' | 'remote_unavailable';
}
