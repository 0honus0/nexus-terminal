import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import {
	RemoteFileFailure,
	type FileDownloadTicketBinding,
	type FileDownloadTicketClaim,
} from '../model/file-types.js';
interface DownloadTicketLease {
	id: string;
	binding: FileDownloadTicketBinding;
	expiresAt: number;
	ownerIp: string | null;
	activeRequests: number;
	digest: Buffer;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_TOTAL = 512;
const MAX_PER_USER = 64;

/** Scoped short-lived download capabilities, kept solely inside Remote Service. */
export class DownloadTickets {
	private readonly tickets = new Map<string, DownloadTicketLease>();

	issue(input: FileDownloadTicketBinding): string {
		this.prune();
		const owned = [...this.tickets.values()].filter((ticket) => ticket.binding.userId === input.userId);
		if (this.tickets.size >= MAX_TOTAL || owned.length >= MAX_PER_USER) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		const id = randomUUID();
		const secret = randomBytes(32).toString('base64url');
		this.tickets.set(id, {
			binding: {
				userId: input.userId,
				sessionDigest: input.sessionDigest,
				resourceId: input.resourceId,
				connectionId: input.connectionId,
				workspaceId: input.workspaceId,
				remotePath: input.remotePath,
				fileSize: input.fileSize,
				fileMtimeSeconds: input.fileMtimeSeconds,
			},
			id,
			digest: createHash('sha256').update(secret).digest(),
			expiresAt: Date.now() + TTL_MS,
			ownerIp: null,
			activeRequests: 0,
		});
		return id + '.' + secret;
	}

	claim(
		token: string,
		sourceIp: string,
	): { kind: 'gone' | 'locked' } | { kind: 'ok'; claim: FileDownloadTicketClaim } {
		this.prune();
		const separator = token.indexOf('.');
		if (separator < 1 || separator === token.length - 1 || token.length > 256) {
			return { kind: 'gone' };
		}
		const lease = this.tickets.get(token.slice(0, separator));
		if (!lease || lease.expiresAt <= Date.now()) {
			return { kind: 'gone' };
		}
		const digest = createHash('sha256')
			.update(token.slice(separator + 1))
			.digest();
		if (digest.length !== lease.digest.length || !timingSafeEqual(digest, lease.digest)) {
			return { kind: 'gone' };
		}
		if (lease.ownerIp !== null && lease.ownerIp !== sourceIp) {
			return { kind: 'locked' };
		}
		lease.ownerIp = sourceIp;
		lease.activeRequests += 1;
		let released = false;
		return {
			kind: 'ok',
			claim: {
				binding: {
					userId: lease.binding.userId,
					sessionDigest: lease.binding.sessionDigest,
					resourceId: lease.binding.resourceId,
					connectionId: lease.binding.connectionId,
					workspaceId: lease.binding.workspaceId,
					remotePath: lease.binding.remotePath,
					fileSize: lease.binding.fileSize,
					fileMtimeSeconds: lease.binding.fileMtimeSeconds,
				},

				release: () => {
					if (!released) {
						released = true;
						this.release(lease);
					}
				},

				complete: () => this.complete(lease),

				invalidate: () => this.invalidate(lease),
			},
		};
	}

	private release(lease: DownloadTicketLease): void {
		if (this.tickets.get(lease.id) !== lease) {
			return;
		}
		lease.activeRequests = Math.max(0, lease.activeRequests - 1);
		if (lease.activeRequests === 0 && lease.expiresAt <= Date.now()) {
			this.tickets.delete(lease.id);
		}
	}

	private complete(lease: DownloadTicketLease): void {
		if (this.tickets.get(lease.id) === lease) {
			lease.expiresAt = Date.now() + TTL_MS;
		}
	}

	private invalidate(lease: DownloadTicketLease): void {
		if (this.tickets.get(lease.id) === lease) {
			this.tickets.delete(lease.id);
		}
	}

	private prune(): void {
		const now = Date.now();
		for (const [id, lease] of this.tickets) {
			// The old registry expired and destroyed active download streams after
			// five idle minutes, even under slow-client backpressure. In-flight
			// tickets are owned by the request and must survive until it settles.
			if (lease.activeRequests === 0 && lease.expiresAt <= now) {
				this.tickets.delete(id);
			}
		}
	}

	close(): void {
		this.tickets.clear();
	}
}
