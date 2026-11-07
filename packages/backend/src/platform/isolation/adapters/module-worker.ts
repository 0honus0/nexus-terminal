import { AsyncLocalStorage } from 'node:async_hooks';
import { pathToFileURL } from 'node:url';

const MAX_MESSAGE_BYTES = 512 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error('Invalid module protocol');
	}
	return value;
}

function send(value: unknown): Promise<void> {
	const encoded = JSON.stringify(value) + '\n';
	if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) {
		return Promise.reject(new Error('Module message exceeds capacity'));
	}
	return new Promise((resolve, reject) =>
		process.stdout.write(encoded, (error) => (error ? reject(error) : resolve())),
	);
}

async function main(): Promise<void> {
	const entry = process.env.NEXUS_MODULE_ENTRY,
		context = process.env.NEXUS_MODULE_CONTEXT;
	if (!entry || !context) {
		throw new Error('Missing module configuration');
	}
	// stdout belongs exclusively to the framing protocol.
	console.log = console.info = console.warn = (...args: unknown[]) => console.error(...args);
	const invocationContext = new AsyncLocalStorage<number>();
	let sequence = 0;
	let closing = false;
	const pending = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: unknown): void; timer: NodeJS.Timeout | null }
	>();
	let writes = Promise.resolve();

	const write = (value: unknown) => {
		const next = writes.then(() => send(value));
		writes = next;
		void next.catch(() => process.exit(1));
		return next;
	};

	const requestForControl = (input: unknown, controlId: number | null, source = false): Promise<unknown> => {
		// Actual pipe backpressure owns writes; cancellation and closing retain their original controls.
		if (closing || sequence >= Number.MAX_SAFE_INTEGER) {
			return Promise.reject(new Error('Module host unavailable'));
		}
		const id = ++sequence;
		const result = new Promise<unknown>((resolve, reject) => {
			const timer = null;
			pending.set(id, { resolve, reject, timer });
		});
		void result.catch(() => undefined);
		void write({ kind: source ? 'source' : 'host', id, controlId, input }).catch((error) => {
			const waiting = pending.get(id);
			if (waiting) {
				if (waiting.timer !== null) {
					clearTimeout(waiting.timer);
				}
				pending.delete(id);
				waiting.reject(error);
			}
		});
		return result;
	};

	const request = (input: unknown): Promise<unknown> =>
		requestForControl(input, invocationContext.getStore() ?? null);

	const imported: unknown = await import(pathToFileURL(entry).href);
	const exports = record(imported);
	const module = exports.default === undefined ? exports : record(exports.default);
	for (const name of ['activate', 'health', 'quiesce', 'dispose', 'agent', 'dispatch']) {
		if (module[name] !== undefined && typeof module[name] !== 'function') {
			throw new Error('Invalid lifecycle export');
		}
	}
	const activation = Object.freeze({ context: Object.freeze(record(JSON.parse(context))), request });
	let lifecycleLane = Promise.resolve();
	const activeInvocations = new Set<Promise<void>>();
	let active = false;
	let lastControl = 0;
	let controls = 0;
	const invocations = new Map<number, AbortController>();

	const control = async (message: Record<string, unknown>) => {
		const method = message.method;
		try {
			if (method === 'activate') {
				if (active) {
					throw new Error('Module already activated');
				}
				const value: unknown = typeof module.activate === 'function' ? await module.activate(activation) : null;
				active = true;
				await write({ kind: 'result', id: message.id, ok: true, value: value === undefined ? null : value });
				return;
			} else if (method === 'invoke') {
				const exportName = typeof message.exportName === 'string' ? message.exportName : 'agent';
				const agent =
					message.exportName === undefined ? module.agent : (module[exportName] ?? exports[exportName]);
				if (!active || closing || typeof agent !== 'function' || !isRecord(message.input)) {
					throw new Error('Agent extension unavailable');
				}
				const controller = invocations.get(Number(message.id));
				if (!controller) {
					throw new Error('Missing invocation');
				}
				controller.signal.throwIfAborted();
				const source: Record<string, (input: unknown) => Promise<unknown>> = {};
				if (Array.isArray(message.sourceMethods)) {
					for (const method of message.sourceMethods) {
						if (typeof method !== 'string') {
							throw new Error('Invalid source method');
						}
						source[method] = (input) => requestForControl({ method, input }, Number(message.id), true);
					}
				}
				const value: unknown = await invocationContext.run(Number(message.id), () =>
					message.exportName === undefined
						? agent(message.input, controller.signal)
						: agent(message.input, Object.freeze(source), controller.signal),
				);
				await write({ kind: 'result', id: message.id, ok: true, value: value === undefined ? null : value });
				return;
			} else if (method === 'health') {
				const value: unknown = typeof module.health === 'function' ? await module.health() : true;
				if (typeof value !== 'boolean') {
					throw new Error('Invalid health result');
				}
				await write({ kind: 'result', id: message.id, ok: true, value });
				return;
			} else if (method === 'quiesce') {
				closing = true;
				if (typeof module.quiesce === 'function') {
					await module.quiesce(message.deadline);
				}
			} else if (method === 'dispose') {
				closing = true;
				if (typeof module.dispose === 'function') {
					await module.dispose();
				}
			} else {
				throw new Error('Invalid lifecycle method');
			}
			await write({ kind: 'result', id: message.id, ok: true, value: null });
			if (method === 'dispose') {
				process.exit(0);
			}
		} catch {
			await write({ kind: 'result', id: message.id, ok: false });
		} finally {
			if (typeof message.id === 'number') {
				invocations.delete(message.id);
			}
		}
	};

	await write({ kind: 'ready', protocol: 1 });
	let buffer = Buffer.alloc(0);
	for await (const chunk of process.stdin) {
		buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
		let end: number;
		while ((end = buffer.indexOf(10)) !== -1) {
			if (end > MAX_MESSAGE_BYTES) {
				throw new Error('Module message exceeds capacity');
			}
			const message = record(
				JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, end))),
			);
			buffer = buffer.subarray(end + 1);
			if (typeof message.id !== 'number' || !Number.isSafeInteger(message.id) || message.id < 1) {
				throw new Error('Invalid message identity');
			}
			if (message.kind === 'cancel') {
				if (Object.keys(message).length !== 2) {
					throw new Error('Invalid cancellation');
				}
				invocations.get(message.id)?.abort();
			} else if (message.kind === 'host.result') {
				const success = Object.hasOwn(message, 'value') && !Object.hasOwn(message, 'error');
				const refused = message.error === true && !Object.hasOwn(message, 'value');
				if (Object.keys(message).length !== 3 || (!success && !refused)) {
					throw new Error('Invalid host result');
				}
				const waiting = pending.get(message.id);
				if (waiting) {
					if (waiting.timer !== null) {
						clearTimeout(waiting.timer);
					}
					pending.delete(message.id);
					if (refused) {
						waiting.reject(new Error('Module source request refused'));
					} else {
						waiting.resolve(message.value);
					}
				}
			} else if (message.kind === 'control') {
				if (
					typeof message.method !== 'string' ||
					!['activate', 'health', 'quiesce', 'dispose', 'invoke'].includes(message.method) ||
					Object.keys(message).length !==
						(message.method === 'invoke' && message.exportName !== undefined
							? 6
							: ['quiesce', 'invoke'].includes(message.method)
								? 4
								: 3) ||
					(message.exportName !== undefined &&
						(message.method !== 'invoke' ||
							typeof message.exportName !== 'string' ||
							!/^[a-z][a-zA-Z0-9_]*$/u.test(message.exportName))) ||
					(message.exportName !== undefined &&
						(!Array.isArray(message.sourceMethods) ||
							new Set(message.sourceMethods).size !== message.sourceMethods.length ||
							message.sourceMethods.some(
								(name: unknown) => typeof name !== 'string' || !/^[a-z][a-zA-Z0-9_]*$/u.test(name),
							))) ||
					(message.exportName === undefined && message.sourceMethods !== undefined) ||
					(message.method === 'invoke' && !isRecord(message.input)) ||
					(message.method === 'quiesce' &&
						(typeof message.deadline !== 'number' ||
							!Number.isSafeInteger(message.deadline) ||
							message.deadline < 0))
				) {
					throw new Error('Invalid lifecycle control');
				}
				if (message.id <= lastControl) {
					throw new Error('Invalid control sequence');
				}
				lastControl = message.id;
				controls++;
				if (message.method === 'invoke') {
					invocations.set(message.id, new AbortController());
					const task = lifecycleLane.then(() => control(message)).finally(() => controls--);
					activeInvocations.add(task);
					void task.then(
						() => activeInvocations.delete(task),
						() => activeInvocations.delete(task),
					);
					void task.catch(() => process.exit(1));
				} else {
					if (message.method === 'quiesce' || message.method === 'dispose') {
						closing = true;
					}
					// Capture before installing this barrier. Later invocations wait for
					// it and must never enter its own drain set.
					const admitted = [...activeInvocations];
					lifecycleLane = lifecycleLane
						.then(async () => {
							await Promise.all(admitted);
							await control(message);
						})
						.finally(() => controls--);
					void lifecycleLane.catch(() => process.exit(1));
				}
			} else {
				throw new Error('Invalid message kind');
			}
		}
		if (buffer.byteLength > MAX_MESSAGE_BYTES) {
			throw new Error('Module message exceeds capacity');
		}
	}
	process.exit(1);
}

void main().catch(() => process.exit(1));
