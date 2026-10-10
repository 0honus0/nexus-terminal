export interface TargetHostKeyRequest {
	host: string;
	port: number;
}
export interface TargetHostKeyConfirmRequest extends TargetHostKeyRequest {
	fingerprint: string;
}
export interface TargetHostKeyRemoveResponse {
	removed: true;
}
