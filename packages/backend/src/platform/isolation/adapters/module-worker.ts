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
	let sequence = 0;
	let closing = false;
	const pending = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: unknown): void; timer: NodeJS.Timeout }
	>();
	let writes = Promise.resolve();

	const write = (value: unknown) => {
		const next = writes.then(() => send(value));
		writes = next;
		void next.catch(() => process.exit(1));
		return next;
	};

	const request = (input: unknown): Promise<unknown> => {
		if (closing || pending.size >= 32 || sequence >= Number.MAX_SAFE_INTEGER) {
			return Promise.reject(new Error('Module host unavailable'));
		}
		const id = ++sequence;
		const result = new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error('Module host outcome unknown'));
			}, 30000);
			pending.set(id, { resolve, reject, timer });
		});
		void result.catch(() => undefined);
		void write({ kind: 'host', id, input }).catch((error) => {
			const waiting = pending.get(id);
			if (waiting) {
				clearTimeout(waiting.timer);
				pending.delete(id);
				waiting.reject(error);
			}
		});
		return result;
	};

	const imported: unknown = await import(pathToFileURL(entry).href);
	const exports = record(imported);
	const module = exports.default === undefined ? exports : record(exports.default);
	for (const name of ['activate', 'health', 'quiesce', 'dispose']) {
		if (module[name] !== undefined && typeof module[name] !== 'function') {
			throw new Error('Invalid lifecycle export');
		}
	}
	const activation = Object.freeze({ context: Object.freeze(record(JSON.parse(context))), request });
	let lane = Promise.resolve();
	let active = false;
	let lastControl = 0;
	let controls = 0;

	const control = async (message: Record<string, unknown>) => {
		const method = message.method;
		try {
			if (method === 'activate') {
				if (active) {
					throw new Error('Module already activated');
				}
				if (typeof module.activate === 'function') {
					await module.activate(activation);
				}
				active = true;
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
			if (message.kind === 'host.result') {
				if (Object.keys(message).length !== 3 || !Object.hasOwn(message, 'value')) {
					throw new Error('Invalid host result');
				}
				const waiting = pending.get(message.id);
				if (waiting) {
					clearTimeout(waiting.timer);
					pending.delete(message.id);
					waiting.resolve(message.value);
				}
			} else if (message.kind === 'control') {
				if (
					typeof message.method !== 'string' ||
					!['activate', 'health', 'quiesce', 'dispose'].includes(message.method) ||
					Object.keys(message).length !== (message.method === 'quiesce' ? 4 : 3) ||
					(message.method === 'quiesce' &&
						(typeof message.deadline !== 'number' ||
							!Number.isSafeInteger(message.deadline) ||
							message.deadline < 0))
				) {
					throw new Error('Invalid lifecycle control');
				}
				if (message.id <= lastControl || controls >= 8) {
					throw new Error('Invalid control sequence');
				}
				lastControl = message.id;
				controls++;
				lane = lane.then(() => control(message)).finally(() => controls--);
				void lane.catch(() => process.exit(1));
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
