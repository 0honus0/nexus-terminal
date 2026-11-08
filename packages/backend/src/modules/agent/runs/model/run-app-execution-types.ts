/** Run provenance freezes App code, independently of the current optional capability catalogue. */
export interface RunAppExecution {
	kind: 'plugin';
	package: { packageId: string; version: string; packageHash: string; publisherKeyId: string };
	codeDependencies: { packageId: string; version: string; packageHash: string; publisherKeyId: string }[];
	handler: string;
}
