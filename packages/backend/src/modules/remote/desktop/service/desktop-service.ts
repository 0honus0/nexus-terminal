import type { AccessPublicApi } from '../../../access/public.js';
import type { TrustedDesktopTargets } from '../../../targets/public.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { toDesktopConnection } from '../model/desktop-model.js';
import type { DesktopModel } from '../model/desktop-model.js';
import type { DesktopDisplay, DesktopTicket, DesktopPeer, DesktopTicketResult } from '../model/desktop-types.js';
import type { RemoteDesktopProtocol } from '@nexus-terminal/shared/remote/desktop/values';
import {
	REMOTE_DESKTOP_TICKET_TTL_MS,
	REMOTE_DESKTOP_MAX_PENDING_TICKETS,
	REMOTE_DESKTOP_MAX_ACTIVE_SESSIONS,
} from '@nexus-terminal/shared/remote/desktop/values';
import { TargetOperationError } from '../../../targets/public-errors.js';
import { DesktopFailure } from '../desktop-errors.js';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';

const ISSUE_TIMEOUT_MS = 15_000;
const CLOSE_WAIT_MS = 30_000;

interface DesktopSlot {
	peer: DesktopPeer;
	opening: Promise<void>;
	technicalTerminated: Promise<void>;
	closing: Promise<void> | null;
	authorizationPoll: ReturnType<typeof setInterval> | null;
	authorizationTask: Promise<void> | null;
	polling: boolean;
}

interface TimedReservation {
	expired: boolean;
}

/** Sole ticket and live-slot owner. Guacamole state remains technology-only. */
export class DesktopService {
	private readonly tickets = new Map<string, DesktopTicket>();
	private readonly issuing = new Set<TimedReservation>();
	private readonly tasks = new Set<Promise<unknown>>();
	private readonly slots = new Set<DesktopSlot>();
	private readonly failures = new FailureSummary();
	private readonly recordedFailures = new WeakSet<Error>();
	private accepting = true;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly targets: TrustedDesktopTargets,
		private readonly model: DesktopModel,
	) {}

	private recordFailure(error: unknown): void {
		if (error instanceof Error) {
			if (this.recordedFailures.has(error)) {
				return;
			}
			this.recordedFailures.add(error);
		}
		this.failures.record(error);
	}

	private track<T>(task: Promise<T>): Promise<T> {
		this.tasks.add(task);
		void task.catch((error: unknown) => {
			if (error instanceof RemoteResourceCleanupFailure) {
				this.recordFailure(error);
			}
		});
		void task.finally(() => this.tasks.delete(task)).catch(() => undefined);
		return task;
	}

	/** Rejected upgrades remain the raw HTTP owner's sockets until closed. */
	private async refuseSocket(peer: DesktopPeer, reason: 'limit_exceeded' | 'invalid_input'): Promise<void> {
		peer.requestClose(reason);
		try {
			await peer.waitClosed(5000);
		} catch (gracefulError) {
			if (!peer.isClosed) {
				peer.disconnect();
			}
			try {
				await peer.waitClosed(5000);
			} catch (forcedError) {
				throw new RemoteResourceCleanupFailure([gracefulError, forcedError]);
			}
		}
	}

	private async identity(token: string | null): Promise<number> {
		if (!token) {
			throw new DesktopFailure('unauthenticated');
		}
		const identity = await this.access.authenticate(token);
		if (!identity) {
			throw new DesktopFailure('unauthenticated');
		}
		if (identity.userId !== 1) {
			throw new DesktopFailure('forbidden');
		}
		return identity.userId;
	}

	private prune(): void {
		const now = Date.now();
		for (const [ticket, record] of this.tickets) {
			if (record.expiresAt <= now) {
				this.tickets.delete(ticket);
			}
		}
	}

	/** Revoke a ticket whose response was not delivered to the HTTP caller. */
	discard(ticket: string): void {
		this.tickets.delete(ticket);
	}

	/** A timeout only ends HTTP waiting, not the underlying Targets operation. */
	async issue(
		token: string | null,
		targetId: number,
		protocol: RemoteDesktopProtocol,
		display: DesktopDisplay,
		signal?: AbortSignal,
	): Promise<DesktopTicketResult> {
		if (!token) {
			throw new DesktopFailure('unauthenticated');
		}
		if (!Number.isSafeInteger(targetId) || targetId < 1) {
			throw new DesktopFailure('invalid_input');
		}
		if (!this.accepting) {
			throw new DesktopFailure('remote_unavailable');
		}
		if (signal?.aborted) {
			throw new DesktopFailure('remote_unavailable');
		}
		this.prune();
		if (this.tickets.size + this.issuing.size >= REMOTE_DESKTOP_MAX_PENDING_TICKETS) {
			throw new DesktopFailure('limit_exceeded');
		}
		const reservation: TimedReservation = { expired: false };
		this.issuing.add(reservation); // Synchronous capacity admission.
		const original = this.track(
			(async () => {
				try {
					const userId = await this.identity(token);
					this.validateReservation(reservation, signal);
					const target = await this.targets.get(targetId);
					this.validateReservation(reservation, signal);
					if (!target) {
						throw new DesktopFailure('not_found');
					}
					if (target.protocol !== protocol) {
						throw new DesktopFailure('invalid_input');
					}
					// Match old semantics: valid target type counts as an attempt
					// even if subsequent Guacamole/ticket setup fails.
					const lastConnectedAt = Math.floor(Date.now() / 1000);
					if (!(await this.targets.markAttempt(targetId, target.version, lastConnectedAt))) {
						throw new DesktopFailure('conflict');
					}
					this.validateReservation(reservation, signal);
					// Match the old recent-connection contract: an attempted
					// desktop with no stored password still records the attempt.
					if (!target.password) {
						throw new DesktopFailure('invalid_input');
					}
					if ((await this.identity(token)) !== userId) {
						throw new DesktopFailure('unauthenticated');
					}
					this.validateReservation(reservation, signal);
					const ticket = this.model.issueTicket();
					if (this.tickets.size >= REMOTE_DESKTOP_MAX_PENDING_TICKETS) {
						throw new DesktopFailure('limit_exceeded');
					}
					this.tickets.set(ticket, {
						userId,
						tokenDigest: this.model.digestToken(token),
						targetId,
						targetVersion: target.version,
						protocol,
						expiresAt: Date.now() + REMOTE_DESKTOP_TICKET_TTL_MS,
						display: { width: display.width, height: display.height, dpi: display.dpi },
					});
					return { ticket, lastConnectedAt };
				} finally {
					this.issuing.delete(reservation);
				}
			})(),
		);
		const wait = new Promise<never>((_, reject) => {
			let timer: ReturnType<typeof setTimeout> | null = null;

			const stop = () => {
				reservation.expired = true;
				reject(new DesktopFailure('remote_unavailable'));
			};

			timer = setTimeout(stop, ISSUE_TIMEOUT_MS);
			timer.unref();

			const abort = () => stop();

			signal?.addEventListener('abort', abort, { once: true });
			if (signal?.aborted) {
				abort();
			}
			void original
				.finally(() => {
					if (timer) {
						clearTimeout(timer);
					}
					signal?.removeEventListener('abort', abort);
				})
				.catch(() => undefined);
		});
		try {
			return await Promise.race([original, wait]);
		} catch (error) {
			if (error instanceof DesktopFailure) {
				throw error;
			}
			if (error instanceof TargetOperationError) {
				if (error.code === 'reference_not_found') {
					throw new DesktopFailure('not_found');
				}
				if (error.code === 'invalid_input' || error.code === 'unresolvable') {
					throw new DesktopFailure('invalid_input');
				}
				if (error.code === 'conflict') {
					throw new DesktopFailure('conflict');
				}
			}
			throw new DesktopFailure('remote_unavailable', { cause: error });
		}
	}

	private validateReservation(reservation: TimedReservation, signal?: AbortSignal): void {
		if (!this.accepting || reservation.expired || signal?.aborted) {
			throw new DesktopFailure('remote_unavailable');
		}
	}

	/** Consume once before any await; a rejected handshake never restores a bearer ticket. */
	async accept(token: string | null, ticket: string, peer: DesktopPeer): Promise<void> {
		this.prune();
		if (!this.accepting || !peer.isOpen || this.slots.size >= REMOTE_DESKTOP_MAX_ACTIVE_SESSIONS) {
			await this.refuseSocket(peer, 'limit_exceeded');
			return;
		}
		const record = this.tickets.get(ticket);
		if (
			!token ||
			!record ||
			record.expiresAt <= Date.now() ||
			record.tokenDigest !== this.model.digestToken(token)
		) {
			await this.refuseSocket(peer, 'invalid_input');
			return;
		}
		this.tickets.delete(ticket);

		let confirmTechnicalTermination: () => void = () => undefined;

		const technicalTerminated = new Promise<void>((resolve) => {
			confirmTechnicalTermination = resolve;
		});
		const slot: DesktopSlot = {
			peer,
			opening: Promise.resolve(),
			closing: null,
			technicalTerminated,
			authorizationPoll: null,
			authorizationTask: null,
			polling: false,
		};
		this.slots.add(slot);

		let signalEnding: () => void = () => undefined;

		const ending = new Promise<void>((resolve) => {
			signalEnding = resolve;
		});
		let lateRetirementScheduled = false;

		const retireAfterLateConfirmation = () => {
			if (lateRetirementScheduled) {
				return;
			}
			lateRetirementScheduled = true;
			const original = Promise.allSettled([slot.opening, slot.technicalTerminated, slot.authorizationTask]).then(
				() => {
					if (peer.isClosed) {
						this.slots.delete(slot);
					} else {
						// Vendor removes all pre-existing close listeners. Install
						// this listener only after its terminal callback settles.
						peer.onClosed(() => this.slots.delete(slot));
					}
				},
			);
			void this.track(original);
		};

		const onClose = () => {
			signalEnding();
			void this.closeSlot(slot).catch((error) => this.recordFailure(error));
			retireAfterLateConfirmation();
		};

		peer.onClosed(onClose);
		const opening = (async () => {
			let dispatched = false;
			try {
				const userId = await this.identity(token);
				const current = await this.targets.get(record.targetId);
				if (
					!current ||
					current.version !== record.targetVersion ||
					current.protocol !== record.protocol ||
					userId !== record.userId ||
					!current.password ||
					!this.accepting ||
					!peer.isOpen ||
					slot.closing ||
					record.expiresAt <= Date.now() ||
					(await this.identity(token)) !== userId ||
					!this.accepting ||
					!peer.isOpen ||
					slot.closing
				) {
					throw new DesktopFailure('not_found');
				}
				// Rebuild from current Targets snapshot; never hand an old
				// credential from a consumed ticket to the technical adapter.
				const connection = toDesktopConnection(current);
				dispatched = true;
				await peer.open(connection, record.display, () => {
					confirmTechnicalTermination();
					signalEnding();
					retireAfterLateConfirmation();
					void this.closeSlot(slot).catch((error) => this.recordFailure(error));
				});
				// guacd 'ready' may arrive after the original target/password
				// or Access session changed while the handshake was in flight.
				const latestUser = await this.identity(token);
				const latestTarget = await this.targets.get(record.targetId);
				if (
					slot.closing ||
					!peer.isOpen ||
					!this.accepting ||
					latestUser !== userId ||
					!latestTarget ||
					latestTarget.version !== record.targetVersion ||
					latestTarget.protocol !== record.protocol
				) {
					throw new DesktopFailure('not_found');
				}
				if (peer.isOpen && !slot.closing && this.accepting) {
					this.startAuthorizationPoll(slot, token, record);
				}
			} catch (error) {
				// Authentication/configuration failed before a transport was
				// created: no guacd owner remains to send onTerminated.
				if (!dispatched) {
					confirmTechnicalTermination();
				}
				if (peer.isOpen) {
					peer.requestClose('remote_unavailable');
				}
				throw error;
			}
		})();
		slot.opening = this.track(opening);
		let openingFailure: unknown = null;
		let openingTimer: ReturnType<typeof setTimeout> | null = null;
		try {
			await Promise.race([
				opening,
				new Promise<never>((_, reject) => {
					openingTimer = setTimeout(() => {
						peer.disconnect();
						reject(new DesktopFailure('remote_unavailable'));
					}, 30_000);
					openingTimer.unref();
				}),
			]);
		} catch (error) {
			openingFailure = error;
			// Guacamole's detailed error is technical and may carry secrets.
			// Close waits for actual bridge settlement before freeing its slot.
			if (!peer.isClosed) {
				peer.disconnect();
			}
			signalEnding();
		} finally {
			if (openingTimer) {
				clearTimeout(openingTimer);
			}
		}
		// Keep the Platform HTTP raw WebSocket task alive through real
		// connection termination. The vendor's newConnection Promise alone
		// completes before guacd is ready and cannot own this lifetime.
		await ending;
		try {
			await this.closeSlot(slot);
		} catch (cleanupError) {
			if (openingFailure !== null) {
				throw new RemoteResourceCleanupFailure([openingFailure, cleanupError]);
			}
			throw cleanupError;
		}
	}

	private startAuthorizationPoll(slot: DesktopSlot, token: string, record: DesktopTicket): void {
		slot.authorizationPoll = setInterval(() => {
			if (slot.polling || slot.closing || !slot.peer.isOpen) {
				return;
			}
			slot.polling = true;
			const poll = (async () => {
				const identity = await this.access.authenticate(token);
				if (slot.closing || !slot.peer.isOpen) {
					return;
				}
				const target = await this.targets.get(record.targetId);
				if (
					!this.accepting ||
					slot.closing ||
					!identity ||
					identity.userId !== record.userId ||
					!target ||
					target.version !== record.targetVersion ||
					target.protocol !== record.protocol
				) {
					slot.peer.disconnect();
				}
			})()
				.catch(() => slot.peer.disconnect())
				.finally(() => {
					slot.polling = false;
					if (slot.authorizationTask === poll) {
						slot.authorizationTask = null;
					}
				});
			slot.authorizationTask = this.track(poll);
		}, 15_000);
		slot.authorizationPoll.unref();
	}

	private closeSlot(slot: DesktopSlot): Promise<void> {
		if (slot.closing) {
			return slot.closing;
		}
		if (slot.authorizationPoll) {
			clearInterval(slot.authorizationPoll);
		}
		slot.authorizationPoll = null;
		slot.closing = Promise.resolve().then(async () => {
			if (!slot.peer.isClosed) {
				slot.peer.disconnect();
			}
			// A closed WebSocket alone is insufficient: the guacamole-lite
			// ClientConnection may still own an asynchronous guacd open.
			const actual = Promise.allSettled([
				slot.peer.waitClosed(5000),
				slot.opening,
				slot.technicalTerminated,
				slot.authorizationTask,
			]);
			let timer: ReturnType<typeof setTimeout> | null = null;
			const expired = new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new DesktopFailure('operation_unknown')), 5000);
				timer.unref();
			});
			let confirmed: Awaited<typeof actual>;
			try {
				confirmed = await Promise.race([actual, expired]);
			} finally {
				if (timer) {
					clearTimeout(timer);
				}
			}
			const closeFailed = confirmed[0].status === 'rejected' || confirmed[2].status === 'rejected';
			if (closeFailed) {
				// The opening rejection is the operation's cause, not proof
				// that the socket/guacd cleanup was unsuccessful. Include it
				// only when a separate close confirmation also failed.
				throw new RemoteResourceCleanupFailure(
					confirmed.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : [])),
				);
			}
			this.slots.delete(slot);
		});
		return slot.closing;
	}

	quiesce(): void {
		this.accepting = false;
		this.tickets.clear();
		for (const reservation of this.issuing) {
			reservation.expired = true;
		}
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.quiesce();
		this.closePromise = Promise.resolve().then(async () => {
			const settleTasks = Promise.allSettled([...this.tasks]);
			let waitTimer: ReturnType<typeof setTimeout> | null = null;
			const pendingResult = Promise.race([
				settleTasks,
				new Promise<never>((_, reject) => {
					waitTimer = setTimeout(() => reject(new DesktopFailure('operation_unknown')), CLOSE_WAIT_MS);
					waitTimer.unref();
				}),
			])
				.then((results) => {
					const errors = results.flatMap((item) =>
						item.status === 'rejected' && item.reason instanceof RemoteResourceCleanupFailure
							? [item.reason]
							: [],
					);
					for (const error of errors) {
						this.recordFailure(error);
					}
				})
				.finally(() => {
					if (waitTimer) {
						clearTimeout(waitTimer);
					}
				});
			// Technical shutdown starts independently in module registration;
			// drain application tasks and peer closures together.
			const cleanup = [
				...[...this.slots].map((slot) => Promise.resolve().then(() => this.closeSlot(slot))),
				pendingResult,
			];
			const result = await Promise.allSettled(cleanup);
			for (const item of result) {
				if (item.status === 'rejected') {
					this.recordFailure(item.reason);
				}
			}
			const failed = this.failures.errors();
			if (failed.length || this.slots.size) {
				throw new RemoteResourceCleanupFailure([
					...failed,
					...(this.slots.size ? [new DesktopFailure('operation_unknown')] : []),
				]);
			}
		});
		return this.closePromise;
	}
}
