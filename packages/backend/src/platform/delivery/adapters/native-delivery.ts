import nodemailer from 'nodemailer';
import type { Delivery, DeliveryRequest } from '../delivery.js';
import { DeliveryFailure } from '../delivery.js';

function isSmtpRecipientRejection(error: unknown): boolean {
	// Nodemailer reports EENVELOPE/RCPT TO only when every recipient was refused before DATA.
	return (
		error instanceof Error &&
		'code' in error &&
		error.code === 'EENVELOPE' &&
		'command' in error &&
		error.command === 'RCPT TO' &&
		'responseCode' in error &&
		typeof error.responseCode === 'number' &&
		Number.isInteger(error.responseCode) &&
		error.responseCode >= 400 &&
		error.responseCode < 600
	);
}

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
				const failure = response.ok ? null : new DeliveryFailure('failed');
				try {
					await response.body?.cancel();
				} catch (cleanup) {
					throw new DeliveryFailure('cleanup_failed', {
						cause:
							failure === null
								? cleanup
								: new AggregateError([failure, cleanup], 'Delivery and release failed'),
					});
				}
				if (failure !== null) {
					throw failure;
				}
			} catch (error) {
				if (error instanceof DeliveryFailure) {
					throw error;
				}
				throw new DeliveryFailure(dispatched ? 'unknown' : 'failed', { cause: error });
			}
			return;
		}
		const transport = this.createTransport(input);
		await this.sendMail(transport, input, signal);
	}

	private createTransport(
		input: Extract<DeliveryRequest, { kind: 'smtp' }>,
	): ReturnType<typeof nodemailer.createTransport> {
		try {
			return nodemailer.createTransport({
				host: input.host,
				port: input.port,
				secure: input.secure,
				auth: input.username ? { user: input.username, pass: input.password ?? '' } : undefined,
				connectionTimeout: 10000,
				greetingTimeout: 10000,
				socketTimeout: 15000,
			});
		} catch (cause) {
			throw new DeliveryFailure('failed', { cause });
		}
	}

	private async sendMail(
		transport: ReturnType<typeof nodemailer.createTransport>,
		input: Extract<DeliveryRequest, { kind: 'smtp' }>,
		signal: AbortSignal,
	): Promise<void> {
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
					: new DeliveryFailure(!dispatched || isSmtpRecipientRejection(error) ? 'failed' : 'unknown', {
							cause: error,
						});
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
