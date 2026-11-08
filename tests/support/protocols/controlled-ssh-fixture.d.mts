export type ControlledSsh = {
	directory: string;
	root: string;
	host: string;
	port: number;
	transferTargetPort: number;
	controlPort: number;
	controlUrl: string;
	username: string;
	password: string;
	fingerprint: string;
	close(): Promise<void>;
};

export function openControlledSsh(directory: string): Promise<ControlledSsh>;
