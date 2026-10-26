import { constants } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import puppeteer, { TimeoutError } from 'puppeteer-core';
import type { Browser, BrowserContext, Page, CDPSession, HTTPRequest, KeyInput } from 'puppeteer-core';
import WebSocket from 'ws';
import type {
	BrowserClient,
	BrowserConnect,
	BrowserSession,
	BrowserSnapshot,
	BrowserAction,
	BrowserActionResult,
	BrowserNode,
} from '../browser-client.js';

import { BrowserFailure } from '../browser-client.js';
import { FailureSummary } from '../../lifecycle/failure-summary.js';

/** CDP binary replies are JSON/base64 strings, bounded by the local runtime representation. */
const BROWSER_BINARY_MAX_BYTES = Math.min(
	constants.MAX_LENGTH,
	Math.floor((constants.MAX_STRING_LENGTH - 64 * 1024) / 4) * 3,
);

function isRecord(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

/** The adapter owns only the new isolated browser context and its local transport. */
class NativeBrowserSession implements BrowserSession {
	readonly maxUploadBytes = BROWSER_BINARY_MAX_BYTES;
	private snapshotId: string | null = null;
	private documentVersion = 0;
	private readonly nodes = new Map<string, number>();
	private readonly requests = new Set<Promise<void>>();
	private readonly failures = new FailureSummary();
	private readonly logs: { sequence: number; type: string; text: string }[] = [];
	private sequence = 0;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly browser: Browser,
		private readonly context: BrowserContext,
		private readonly page: Page,
		private readonly cdp: CDPSession,
		private readonly options: BrowserConnect,
		private readonly transport: { close(): void; dispose(): Promise<void> },
	) {
		page.on('framenavigated', () => this.invalidate());
		cdp.on('DOM.documentUpdated', () => this.invalidate());
		cdp.on('DOM.childNodeRemoved', () => this.invalidate());
		cdp.on('DOM.childNodeInserted', () => this.invalidate());
		cdp.on('DOM.attributeModified', () => this.invalidate());
		cdp.on('DOM.attributeRemoved', () => this.invalidate());
		cdp.on('DOM.characterDataModified', () => this.invalidate());
		page.on('console', (message) => {
			this.logs.push({
				sequence: ++this.sequence,
				type: message.type(),
				text: Buffer.from(message.text(), 'utf8').subarray(0, 2048).toString('utf8'),
			});
			if (this.logs.length > 256) {
				this.logs.shift();
			}
		});
		page.on('request', (request) => this.filter(request));
		page.on('popup', (popup) => {
			if (popup) {
				this.track(popup.close());
			}
		});
	}

	private track(task: Promise<void>): void {
		this.requests.add(task);
		void task.then(
			() => this.requests.delete(task),
			(error) => {
				this.failures.record(error);
				this.requests.delete(task);
			},
		);
	}

	private filter(request: HTTPRequest): void {
		if (request.isInterceptResolutionHandled()) {
			return;
		}
		const allowed = request.url() === 'about:blank' || this.options.allowUrl(request.url());
		this.track(allowed ? request.continue() : request.abort('blockedbyclient'));
	}

	private invalidate(): void {
		this.documentVersion++;
		this.snapshotId = null;
		this.nodes.clear();
	}

	private async scope<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
		signal.throwIfAborted();
		if (this.closePromise) {
			throw new BrowserFailure('unavailable');
		}
		let outcome: { ok: true; value: T } | { ok: false; error: unknown };

		const abort = () => {
			void this.close().catch((error) => this.failures.record(error));
		};

		signal.addEventListener('abort', abort, { once: true });
		try {
			outcome = { ok: true, value: await work() };
		} catch (error) {
			outcome = { ok: false, error };
		} finally {
			signal.removeEventListener('abort', abort);
		}
		if (signal.aborted) {
			const causes = outcome.ok ? [signal.reason] : [outcome.error, signal.reason];
			try {
				await this.close();
			} catch (cleanup) {
				throw new BrowserFailure('cleanup_failed', {
					cause: new AggregateError([...causes, cleanup], 'Browser operation, cancellation or close failed'),
				});
			}
			if (!outcome.ok && outcome.error instanceof BrowserFailure && outcome.error.kind === 'cleanup_failed') {
				throw outcome.error;
			}
			throw new BrowserFailure('execution_unknown', {
				cause: new AggregateError(causes, 'Browser operation canceled'),
			});
		}
		if (!outcome.ok) {
			throw outcome.error instanceof BrowserFailure
				? outcome.error
				: new BrowserFailure('unavailable', { cause: outcome.error });
		}
		const failures = this.failures.errors();
		if (failures.length) {
			throw new BrowserFailure('unavailable', {
				cause: new AggregateError(failures, 'Browser callbacks failed'),
			});
		}
		return outcome.value;
	}

	snapshot(maxNodes: number, signal: AbortSignal): Promise<BrowserSnapshot> {
		return this.scope(signal, async () => {
			if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 1024) {
				throw new BrowserFailure('limit_exceeded');
			}
			const version = this.documentVersion;
			const document = await this.cdp.send('DOM.getDocument', { depth: 8, pierce: false });
			if (this.documentVersion !== version) {
				throw new BrowserFailure('stale_snapshot');
			}
			this.invalidate();
			const snapshotId = randomUUID(),
				nodes: BrowserNode[] = [];
			const queue = [{ node: document.root, parentRef: null as string | null }];
			let truncated = false,
				total = 0;
			while (queue.length) {
				const current = queue.shift();
				if (!current) {
					break;
				}
				const ref = String(current.node.backendNodeId);
				if ((current.node.childNodeCount ?? 0) > (current.node.children?.length ?? 0)) {
					truncated = true;
				}
				const attrs = current.node.attributes ?? [];
				const attributes: { name: string; value: string }[] = [];
				for (let index = 0; index < attrs.length; index += 2) {
					const name = attrs[index],
						value = attrs[index + 1];
					if (name !== undefined && value !== undefined) {
						attributes.push({ name, value: Buffer.from(value, 'utf8').subarray(0, 2048).toString('utf8') });
					}
				}
				const entry = {
					ref,
					parentRef: current.parentRef,
					tag: current.node.nodeName,
					text: Buffer.from(current.node.nodeValue, 'utf8').subarray(0, 2048).toString('utf8'),
					attributes,
				};
				const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
				if (nodes.length >= maxNodes || total + bytes > 65536) {
					truncated = true;
					break;
				}
				total += bytes;
				nodes.push(entry);
				this.nodes.set(ref, current.node.backendNodeId);
				for (const node of current.node.children ?? []) {
					if (queue.length >= 4096) {
						truncated = true;
						break;
					}
					queue.push({ node, parentRef: ref });
				}
			}
			this.snapshotId = snapshotId;
			const url = this.page.url();
			const title = await this.page.title();
			if (this.snapshotId !== snapshotId) {
				throw new BrowserFailure('stale_snapshot');
			}
			return { snapshotId, url, title, nodes, truncated };
		});
	}

	screenshot(maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
		return this.scope(signal, async () => {
			if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
				throw new BrowserFailure('limit_exceeded');
			}
			const bytes = await this.page.screenshot({ type: 'png', fullPage: false });
			if (bytes.byteLength > Math.min(maxBytes, BROWSER_BINARY_MAX_BYTES)) {
				throw new BrowserFailure('limit_exceeded');
			}
			return Uint8Array.from(bytes);
		});
	}

	console(
		after: number,
		limit: number,
	): { entries: { sequence: number; type: string; text: string }[]; nextCursor: number; truncated: boolean } {
		const available = this.logs.filter((entry) => entry.sequence > after),
			selected = available.slice(0, limit);
		return {
			entries: selected.map((entry) => ({ sequence: entry.sequence, type: entry.type, text: entry.text })),
			nextCursor: selected.at(-1)?.sequence ?? after,
			truncated: available.length > selected.length || (this.logs[0]?.sequence ?? 1) > after + 1,
		};
	}

	private validateNode(action: { snapshotId: string; nodeRef: string }): number {
		if (this.snapshotId !== action.snapshotId) {
			throw new BrowserFailure('stale_snapshot');
		}
		const backendNodeId = this.nodes.get(action.nodeRef);
		if (backendNodeId === undefined) {
			throw new BrowserFailure('stale_snapshot');
		}
		return backendNodeId;
	}

	private async withNode<T>(
		action: { snapshotId: string; nodeRef: string },
		work: (objectId: string) => Promise<T>,
	): Promise<T> {
		const backendNodeId = this.validateNode(action);
		const result = await this.cdp.send('DOM.resolveNode', { backendNodeId });
		if (!result.object.objectId) {
			throw new BrowserFailure('stale_snapshot');
		}
		const objectId = result.object.objectId;
		let failure: unknown = null;
		try {
			this.validateNode(action);
			return await work(objectId);
		} catch (cause) {
			failure = cause;
			throw cause;
		} finally {
			try {
				await this.cdp.send('Runtime.releaseObject', { objectId });
			} catch (cleanup) {
				throw new BrowserFailure('cleanup_failed', {
					cause:
						failure === null
							? cleanup
							: new AggregateError([failure, cleanup], 'Browser node operation and release failed'),
				});
			}
		}
	}

	perform(action: BrowserAction, signal: AbortSignal): Promise<BrowserActionResult> {
		return this.scope(signal, async () => {
			if (action.kind === 'navigate') {
				if (!this.options.allowUrl(action.url)) {
					throw new BrowserFailure('url_denied');
				}
				this.invalidate();
				await this.page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
			} else if (action.kind === 'back') {
				this.invalidate();
				await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 60000 });
			} else if (action.kind === 'scroll') {
				this.invalidate();
				await this.cdp.send('Input.dispatchMouseEvent', {
					type: 'mouseWheel',
					x: 0,
					y: 0,
					deltaX: action.deltaX,
					deltaY: action.deltaY,
				});
			} else if (action.kind === 'wait') {
				if (action.mode === 'networkIdle') {
					await this.page.waitForNetworkIdle({ idleTime: 500, timeout: action.maxMillis });
				} else {
					await this.delay(action.maxMillis, signal);
				}
			} else if (action.kind === 'press') {
				await this.press(action, signal);
			} else {
				const downloaded = await this.withNode(
					action,
					async (objectId): Promise<BrowserActionResult | null> => {
						if (action.kind === 'download') {
							const maxBytes = Math.min(action.maxBytes, BROWSER_BINARY_MAX_BYTES);
							if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
								throw new BrowserFailure('limit_exceeded');
							}
							const href = await this.cdp.send('Runtime.callFunctionOn', {
								objectId,
								functionDeclaration: 'function(){return this.href || null}',
								returnByValue: true,
							});
							const url: unknown = href.result.value;
							if (typeof url !== 'string' || !this.options.allowUrl(url)) {
								throw new BrowserFailure('url_denied');
							}
							this.validateNode(action);
							const result = await this.page.evaluate(
								'(async function(url,ceiling){const response=await fetch(url,{credentials:"include",redirect:"error"});if(!response.ok||!response.body)throw new Error("download unavailable");const reader=response.body.getReader();let total=0;const chunks=[];try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>ceiling)throw new Error("download limit");chunks.push(part.value);}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}let binary="";for(const chunk of chunks){for(let i=0;i<chunk.length;i+=8192){binary+=String.fromCharCode(...chunk.subarray(i,i+8192));}}return {url:response.url,mediaType:response.headers.get("content-type")?.split(";")[0]||"application/octet-stream",base64:btoa(binary)};})(' +
									JSON.stringify(url) +
									',' +
									maxBytes +
									')',
							);
							if (
								!isRecord(result) ||
								typeof result.url !== 'string' ||
								!this.options.allowUrl(result.url) ||
								typeof result.mediaType !== 'string' ||
								typeof result.base64 !== 'string'
							) {
								throw new BrowserFailure('unavailable');
							}
							const bytes = Buffer.from(result.base64, 'base64');
							if (bytes.byteLength > maxBytes || bytes.toString('base64') !== result.base64) {
								throw new BrowserFailure('limit_exceeded');
							}
							return {
								kind: 'file',
								url: result.url,
								name: new URL(result.url).pathname.split('/').at(-1) || 'download',
								mediaType: result.mediaType,
								bytes,
							};
						}
						if (action.kind === 'upload' && action.bytes.byteLength > this.maxUploadBytes) {
							throw new BrowserFailure('limit_exceeded');
						}
						const functionDeclaration =
							action.kind === 'select'
								? 'function(values){if(this.tagName!=="SELECT")throw new Error("not select");const options=Array.from(this.options);if(values.some(value=>!options.some(option=>option.value===value))||(!this.multiple&&values.length!==1))throw new Error("invalid selection");for(const option of options){option.selected=values.includes(option.value);}this.dispatchEvent(new Event("input",{bubbles:true}));this.dispatchEvent(new Event("change",{bubbles:true}));}'
								: action.kind === 'click'
									? 'function(){this.click()}'
									: action.kind === 'type'
										? 'function(text){if(!("value" in this))throw new Error("not input");this.focus();this.value=text;this.dispatchEvent(new Event("input",{bubbles:true}));this.dispatchEvent(new Event("change",{bubbles:true}));}'
										: 'function(base64,name,mediaType){if(this.tagName!=="INPUT"||this.type!=="file")throw new Error("not file input");const bytes=Uint8Array.from(atob(base64),(character)=>character.charCodeAt(0));const file=new File([bytes],name,{type:mediaType});const transfer=new DataTransfer();transfer.items.add(file);this.files=transfer.files;this.dispatchEvent(new Event("input",{bubbles:true}));this.dispatchEvent(new Event("change",{bubbles:true}));}';
						const argumentsValue =
							action.kind === 'select'
								? [{ value: action.values }]
								: action.kind === 'click'
									? []
									: action.kind === 'type'
										? [{ value: action.text }]
										: [
												{ value: Buffer.from(action.bytes).toString('base64') },
												{ value: action.name },
												{ value: action.mediaType },
											];
						// Retire before mutation: even unknown effects cannot reuse this snapshot.
						this.invalidate();
						const result = await this.cdp.send('Runtime.callFunctionOn', {
							objectId,
							functionDeclaration,
							arguments: argumentsValue,
							returnByValue: true,
							userGesture: true,
						});
						if (result.exceptionDetails) {
							throw new BrowserFailure('execution_unknown');
						}
						return null;
					},
				);
				if (downloaded !== null) {
					return downloaded;
				}
			}
			if ('settleMs' in action) {
				await this.settle(action.settleMs, signal);
			}
			const url = this.page.url();
			if (!this.options.allowUrl(url)) {
				throw new BrowserFailure('execution_unknown');
			}
			return { kind: 'page', url, title: await this.page.title() };
		});
	}

	private async settle(millis: number, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		if (!Number.isSafeInteger(millis) || millis < 0 || millis > 30000) {
			throw new BrowserFailure('limit_exceeded');
		}
		if (millis === 0) {
			return;
		}
		try {
			await this.page.waitForNetworkIdle({ idleTime: Math.min(100, millis), timeout: millis, signal });
		} catch (error) {
			if (!(error instanceof TimeoutError)) {
				throw error;
			}
		}
		signal.throwIfAborted();
	}

	private async press(action: Extract<BrowserAction, { kind: 'press' }>, signal: AbortSignal): Promise<void> {
		if (action.focus !== null) {
			await this.withNode(action.focus, async (objectId) => {
				signal.throwIfAborted();
				this.invalidate();
				const result = await this.cdp.send('Runtime.callFunctionOn', {
					objectId,
					functionDeclaration: 'function(){this.focus()}',
					returnByValue: true,
				});
				if (result.exceptionDetails) {
					throw new BrowserFailure('execution_unknown');
				}
			});
		}
		signal.throwIfAborted();
		this.invalidate();
		const failures: unknown[] = [];
		try {
			for (const modifier of action.modifiers) {
				signal.throwIfAborted();
				await this.page.keyboard.down(modifier);
			}
			signal.throwIfAborted();
			// The application validates the supported keyboard vocabulary before this vendor boundary.
			await this.page.keyboard.press((action.key === 'Space' ? ' ' : action.key) as KeyInput);
		} catch (error) {
			failures.push(error);
		}
		// Attempt every release, including the key whose down/up response may have been lost.
		const released = await Promise.allSettled([
			Promise.resolve().then(() =>
				this.page.keyboard.up((action.key === 'Space' ? ' ' : action.key) as KeyInput),
			),
			...action.modifiers
				.slice()
				.reverse()
				.map((modifier) => Promise.resolve().then(() => this.page.keyboard.up(modifier))),
		]);
		failures.push(...released.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])));
		if (failures.length) {
			throw new BrowserFailure('execution_unknown', {
				cause: new AggregateError(failures, 'Browser keyboard action or release failed'),
			});
		}
	}

	private delay(milliseconds: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				signal.removeEventListener('abort', abort);
				resolve();
			}, milliseconds);

			const abort = () => {
				clearTimeout(timer);
				signal.removeEventListener('abort', abort);
				reject(signal.reason);
			};

			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) {
				abort();
			}
		});
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closePromise = Promise.resolve().then(async () => {
			this.page.removeAllListeners('request');
			this.page.removeAllListeners('popup');
			this.page.removeAllListeners('console');
			this.page.removeAllListeners('framenavigated');
			const released = await Promise.allSettled([
				Promise.resolve().then(() => this.context.close()),
				...this.requests,
			]);
			// A confirmed context close retires its interception tasks; their refusals are not release failures.
			const failures = released[0].status === 'rejected' ? [released[0].reason, ...this.failures.errors()] : [];
			try {
				await this.browser.disconnect();
			} catch (error) {
				failures.push(error);
			}
			try {
				await this.transport.dispose();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) {
				throw new BrowserFailure('cleanup_failed', {
					cause: new AggregateError(failures, 'Browser context release failed'),
				});
			}
		});
		return this.closePromise;
	}
}

export class NativeBrowserClient implements BrowserClient {
	async connect(options: BrowserConnect, signal: AbortSignal): Promise<BrowserSession> {
		if (signal.aborted) {
			throw new BrowserFailure('unavailable', { cause: signal.reason });
		}
		const socket = new WebSocket(options.endpoint, {
			rejectUnauthorized: options.verifyTls,
			maxPayload: 12 * 1024 * 1024,
			handshakeTimeout: 15000,
		});
		// Observe errors from allocation through final close, including handshake cancellation.
		socket.on('error', () => undefined);
		let browser: Browser | null = null,
			context: BrowserContext | null = null,
			session: NativeBrowserSession | null = null;

		const abortConnection = () => {
			// Once connected, keep CDP alive so construction can release its isolated context.
			if (browser === null) {
				socket.terminate();
			}
		};

		try {
			await new Promise<void>((resolve, reject) => {
				const done = () => {
					socket.off('open', open);
					socket.off('error', fail);
					socket.off('close', closed);
					signal.removeEventListener('abort', abort);
				};

				const open = () => {
					done();
					resolve();
				};

				const fail = (error: unknown) => {
					done();
					reject(error);
				};

				const closed = () => fail(new BrowserFailure('unavailable'));

				const abort = () => {
					done();
					socket.terminate();
					reject(signal.reason);
				};

				socket.once('open', open);
				socket.once('error', fail);
				socket.once('close', closed);
				signal.addEventListener('abort', abort, { once: true });
				if (signal.aborted) {
					abort();
				}
			});
			signal.addEventListener('abort', abortConnection, { once: true });
			signal.throwIfAborted();
			// Puppeteer's transport is a CDP string channel; the socket retains the technical payload bound.
			const transport: {
				send(message: string): void;
				close(): void;
				dispose(): Promise<void>;
				onmessage?: (message: string) => void;
				onclose?: () => void;
			} = {
				send: (message) => socket.send(message),

				close: () => socket.terminate(),

				dispose: () => closeSocket(socket),
			};
			socket.on('message', (raw) => transport.onmessage?.(raw.toString()));
			socket.on('close', () => transport.onclose?.());
			socket.on('error', () => socket.terminate());
			browser = await puppeteer.connect({ transport, protocol: 'cdp', protocolTimeout: 60000 });
			context = await browser.createBrowserContext();
			const page = await context.newPage();
			const cdp = await page.createCDPSession();
			session = new NativeBrowserSession(browser, context, page, cdp, options, transport);
			await page.setBypassServiceWorker(true);
			await page.setRequestInterception(true);
			await cdp.send('DOM.enable');
			if (!context.id) {
				throw new BrowserFailure('unavailable');
			}
			await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: context.id });
			signal.throwIfAborted();
			return session;
		} catch (error) {
			const failures: unknown[] = [error];
			if (session) {
				try {
					await session.close();
				} catch (cause) {
					failures.push(cause);
				}
			} else if (context) {
				try {
					await context.close();
				} catch (cause) {
					failures.push(cause);
				}
			}
			if (!session && browser) {
				try {
					await browser.disconnect();
				} catch (cause) {
					failures.push(cause);
				}
			}
			if (!session) {
				try {
					await closeSocket(socket);
				} catch (cause) {
					failures.push(cause);
				}
			}
			throw new BrowserFailure(failures.length > 1 ? 'cleanup_failed' : 'unavailable', {
				cause: new AggregateError(failures, 'Browser connection failed'),
			});
		} finally {
			signal.removeEventListener('abort', abortConnection);
		}
	}
}

function closeSocket(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.CLOSED) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		socket.once('close', () => resolve());
		socket.terminate();
	});
}
