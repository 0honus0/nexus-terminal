import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';

export interface FileHttpSessionAdapterOptions {
	dataDirectory: string;
	secret: string;
	cookieName?: string;
	credentialRevision(userId: number): Promise<string | undefined>;
}

/** Express-compatible persistent session adapter. Bootstrap owns its lifecycle/configuration. */
export class FileHttpSessionAdapter {
	readonly cookieName: string;
	readonly middleware: RequestHandler;
	private readonly store: session.Store;

	constructor(options: FileHttpSessionAdapterOptions) {
		const FileStore = sessionFileStore(session);
		const sessionsPath = path.join(options.dataDirectory, 'sessions');
		fs.mkdirSync(sessionsPath, { recursive: true, mode: 0o700 });
		if (!fs.lstatSync(sessionsPath).isDirectory()) throw new Error('SESSION_DIRECTORY_INVALID');
		fs.chmodSync(sessionsPath, 0o700);
		for (const entry of fs.readdirSync(sessionsPath, { withFileTypes: true })) {
			if (!entry.isFile()) throw new Error('SESSION_DIRECTORY_ENTRY_INVALID');
			fs.chmodSync(path.join(sessionsPath, entry.name), 0o600);
		}
		this.cookieName = options.cookieName || 'nexus.sid';
		this.store = new FileStore({ path: sessionsPath, ttl: 30 * 24 * 60 * 60 });
		const save = this.store.set.bind(this.store);
		let saveTail: Promise<void> = Promise.resolve();
		this.store.set = (id, data, callback) => {
			const task = saveTail.then(async () => {
				if (data.requiresTwoFactor) {
					const deadline = data.pendingTwoFactorExpiresAt;
					if (!deadline || deadline <= Date.now()) throw new Error('PENDING_AUTH_EXPIRED');
					let pending = 0;
					for (const filename of await fs.promises.readdir(sessionsPath)) {
						if (!filename.endsWith('.json')) continue;
						const key = filename.slice(0, -5);
						if (key === id) continue;
						const row = await new Promise<session.SessionData | null | undefined>((resolve, reject) => {
							this.store.get(key, (error, value) => (error ? reject(error) : resolve(value)));
						});
						if (
							row?.requiresTwoFactor &&
							(row.pendingTwoFactorExpiresAt ?? 0) > Date.now() &&
							++pending >= 64
						) {
							throw new Error('PENDING_AUTH_CAPACITY_EXCEEDED');
						}
					}
					data.cookie.originalMaxAge = Math.max(1, deadline - Date.now());
					data.cookie.expires = new Date(deadline);
				}
				await new Promise<void>((resolve, reject) =>
					save(id, data, (error) => (error ? reject(error) : resolve())),
				);
				await fs.promises.chmod(path.join(sessionsPath, `${id}.json`), 0o600);
			});
			saveTail = task.catch(() => undefined);
			void task.then(
				() => callback?.(),
				(error) => callback?.(error),
			);
		};
		const loadSession = session({
			store: this.store,
			name: this.cookieName,
			secret: options.secret,
			resave: false,
			saveUninitialized: false,
			proxy: true,
			cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto' },
		});
		this.middleware = (request, response, next) => {
			loadSession(request, response, (error) => {
				if (error) return next(error);
				const userId = request.session.userId;
				if (
					request.session.requiresTwoFactor &&
					(request.session.pendingTwoFactorExpiresAt ?? 0) <= Date.now()
				) {
					request.session.regenerate((regenerateError) => (regenerateError ? next(regenerateError) : next()));
					return;
				}
				if (!userId) return next();
				void options.credentialRevision(userId).then((revision) => {
					if (!revision || revision !== request.session.credentialRevision) {
						delete request.session.userId;
						delete request.session.username;
						delete request.session.requiresTwoFactor;
						delete request.session.credentialRevision;
						delete request.session.currentChallenge;
						delete request.session.passkeyOrigin;
					}
					next();
				}, next);
			});
		};
	}

	clear(): Promise<void> {
		return new Promise((resolve, reject) => {
			const clear = this.store.clear?.bind(this.store);
			if (!clear) {
				reject(new Error('Session store does not support clear().'));
				return;
			}
			clear((error?: unknown) => (error ? reject(error) : resolve()));
		});
	}
}
