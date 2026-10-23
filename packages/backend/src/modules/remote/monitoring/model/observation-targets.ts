export function observationTargetKey(host: string, port: number): string {
	return host.trim().toLowerCase() + ':' + port;
}
