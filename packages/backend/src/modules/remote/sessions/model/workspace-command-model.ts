import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { RemoteMachineModel } from '../../machines/model/machine-model.js';

const MAX_DIRECTORY_COMMANDS = 4;
const COMMAND_TIMEOUT_MS = 5000;
const MAX_COMMAND_OUTPUT_BYTES = 4096;

/** Ephemeral generic SSH command leases for reading a live interactive shell's
 * /proc/PID/cwd. Never opens another interactive shell and never updates Workspace state.
 */
export class WorkspaceCommandModel {
	private readonly active = new Set<Promise<unknown>>();
	private readonly unconfirmed = new Set<unknown>();
	private accepting = true;

	constructor(private readonly machines: RemoteMachineModel) {}

	execute(targetId: number, fingerprint: string, command: string, signal?: AbortSignal): Promise<string> {
		if (!this.accepting) {
			throw new Error('Workspace command owner is shutting down');
		}
		if (this.active.size + this.unconfirmed.size >= MAX_DIRECTORY_COMMANDS) {
			throw new Error('Workspace command capacity exceeded');
		}
		const task = this.executeOwned(targetId, fingerprint, command, signal);
		this.active.add(task);
		void task.finally(() => this.active.delete(task)).catch(() => undefined);
		return task;
	}

	private async executeOwned(
		targetId: number,
		fingerprint: string,
		command: string,
		signal?: AbortSignal,
	): Promise<string> {
		const controller = new AbortController();

		const abort = () => controller.abort(signal?.reason);

		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) {
			abort();
		}
		const timeout = setTimeout(() => controller.abort(new Error('Directory probe expired')), COMMAND_TIMEOUT_MS);
		timeout.unref();
		let machine: Awaited<ReturnType<RemoteMachineModel['open']>>['machine'] | null = null;
		let failure: unknown = null;
		let output: string | null = null;
		try {
			const opened = await this.machines.open({
				targetId,
				expectedFingerprint: fingerprint,
				timeoutMs: COMMAND_TIMEOUT_MS,
				signal: controller.signal,
			});
			machine = opened.machine;
			controller.signal.throwIfAborted();
			const result = await machine.execute(command, {
				timeoutMs: Math.max(1, COMMAND_TIMEOUT_MS),
				maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
				signal: controller.signal,
			});
			if (result.truncated || result.outcome.status !== 'completed' || controller.signal.aborted) {
				throw new Error('Directory command failed or outcome is unknown');
			}
			output = result.stdout;
		} catch (error) {
			failure = error;
			if (error instanceof RemoteResourceCleanupFailure) {
				this.unconfirmed.add(error);
			}
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener('abort', abort);
			if (machine) {
				try {
					await machine.close();
				} catch (error) {
					const cleanup = new RemoteResourceCleanupFailure(failure === null ? [error] : [failure, error]);
					this.unconfirmed.add(cleanup);
					failure = cleanup;
				}
			}
		}
		if (failure !== null) {
			throw failure;
		}
		if (output === null) {
			throw new Error('Directory command omitted output');
		}
		return output;
	}

	quiesce(): void {
		this.accepting = false;
	}

	async close(): Promise<void> {
		this.quiesce();
		// A failed cwd lookup is an ordinary command failure, not a leaked lease.
		// Only an explicitly unconfirmed machine cleanup blocks shutdown.
		await Promise.allSettled([...this.active]);
		if (this.unconfirmed.size) {
			throw new RemoteResourceCleanupFailure([...this.unconfirmed]);
		}
	}
}
