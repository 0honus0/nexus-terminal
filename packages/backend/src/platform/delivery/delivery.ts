export type DeliveryRequest =
	| {
			kind: 'http';
			url: string;
			method: 'GET' | 'POST' | 'PUT';
			headers: { name: string; value: string }[];
			body: string | null;
	  }
	| {
			kind: 'smtp';
			host: string;
			port: number;
			secure: boolean;
			username: string;
			password: string | null;
			to: string;
			from: string;
			subject: string;
			body: string;
	  };

export class DeliveryFailure extends Error {
	constructor(
		readonly kind: 'failed' | 'unknown' | 'cleanup_failed',
		options?: ErrorOptions,
	) {
		super('Delivery: ' + kind, options);
	}
}

export interface Delivery {
	send(input: DeliveryRequest, signal: AbortSignal): Promise<void>;
}
