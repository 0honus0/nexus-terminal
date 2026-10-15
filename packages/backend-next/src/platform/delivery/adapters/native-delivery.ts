import nodemailer from 'nodemailer';
import type { Delivery, DeliveryRequest } from '../delivery.js';
import { DeliveryFailure } from '../delivery.js';

export class NativeDelivery implements Delivery {
	async send(input: DeliveryRequest, signal: AbortSignal): Promise<void> {
		if (signal.aborted) {
			throw new DeliveryFailure('failed', { cause: signal.reason });
		}
		if (input.kind === 'http') {
			let dispatched = false;
			try {
				const headers = new Headers();
				for (const header of input.headers) {
					headers.set(header.name, header.value);
				}
				dispatched = true;
				const response = await fetch(input.url, {
					method: input.method,
					headers,
					body: input.method === 'GET' ? null : input.body,
					signal,
					redirect: 'error',
				});
				try {
					if (!response.ok) {
						throw new DeliveryFailure('failed');
					}
				} finally {
					await response.body?.cancel();
				}
			} catch (error) {
				if (error instanceof DeliveryFailure) {
					throw error;
				}
				throw new DeliveryFailure(dispatched ? 'unknown' : 'failed', { cause: error });
			}
			return;
		}
		const transport = nodemailer.createTransport({
			host: input.host,
			port: input.port,
			secure: input.secure,
			auth: input.username ? { user: input.username, pass: input.password ?? '' } : undefined,
			connectionTimeout: 10000,
			greetingTimeout: 10000,
			socketTimeout: 15000,
		});

		let abortCleanup: unknown = null;

		const abort = () => {
			try {
				transport.close();
			} catch (error) {
				abortCleanup = error;
			}
		};

		signal.addEventListener('abort', abort, { once: true });
		let failure: unknown = null;
		let dispatched = false;
		try {
			signal.throwIfAborted();
			dispatched = true;
			const result = await transport.sendMail({
				from: input.from,
				to: input.to,
				subject: input.subject,
				text: input.body,
			});
			if (result.rejected.length) {
				throw new DeliveryFailure(result.accepted.length ? 'unknown' : 'failed');
			}
		} catch (error) {
			failure =
				error instanceof DeliveryFailure
					? error
					: new DeliveryFailure(dispatched ? 'unknown' : 'failed', { cause: error });
		} finally {
			signal.removeEventListener('abort', abort);
			try {
				transport.close();
			} catch (error) {
				failure = new DeliveryFailure('cleanup_failed', {
					cause: failure === null ? error : new AggregateError([failure, error], 'Delivery and close failed'),
				});
			}
		}
		if (abortCleanup !== null) {
			failure = new DeliveryFailure('cleanup_failed', {
				cause:
					failure === null
						? abortCleanup
						: new AggregateError([failure, abortCleanup], 'Delivery and abort cleanup failed'),
			});
		}
		if (failure !== null) {
			throw failure;
		}
	}
}
