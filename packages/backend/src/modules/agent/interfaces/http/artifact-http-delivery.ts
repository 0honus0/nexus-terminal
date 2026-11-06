import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { HttpReply } from '../../../../platform/http/http-types.js';
import { AgentFailure } from '../../agent-failure.js';

/** Native transport still waits for the artifact source's final authorization and cleanup. */
export async function deliverArtifactContent(
	reply: HttpReply,
	content: AsyncIterable<Uint8Array>,
	signal: AbortSignal,
): Promise<void> {
	const source = Readable.from(
		(async function* () {
			let finalByte = new Uint8Array(0);
			for await (const bytes of content) {
				const chunk = Buffer.concat([finalByte, bytes]);
				if (!chunk.byteLength) {
					continue;
				}
				finalByte = Uint8Array.of(chunk[chunk.length - 1]);
				if (chunk.length > 1) {
					yield chunk.subarray(0, -1);
				}
			}
			// The grant and source's final validation must settle before a
			// Content-Length client can receive the last byte and finish.
			signal.throwIfAborted();
			if (finalByte.byteLength) {
				yield finalByte;
			}
		})(),
		{ objectMode: false, signal },
	);
	const sourceClosed = Promise.allSettled([finished(source, { cleanup: true })]);
	const status = reply.statusCode;
	let failure: unknown = null;
	try {
		reply.send(source);
		await finished(reply.raw, { signal, cleanup: true });
		if (!source.readableEnded || reply.statusCode !== status) {
			throw new AgentFailure('provider_unavailable');
		}
		const [result] = await sourceClosed;
		if (result.status === 'rejected') {
			throw result.reason;
		}
	} catch (error) {
		failure = error;
		if (!reply.raw.writableFinished) {
			reply.raw.destroy();
		}
	} finally {
		source.destroy();
		const [result] = await sourceClosed;
		if (result.status === 'rejected' && source.errored && result.reason !== failure) {
			failure =
				failure === null
					? result.reason
					: new AggregateError([failure, result.reason], 'Artifact content delivery failed');
		}
	}
	if (failure !== null) {
		throw failure;
	}
}
