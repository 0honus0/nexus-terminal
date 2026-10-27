import { archiveToolRequirements } from '@nexus-terminal/shared/remote/tools/values';
import {
	NativeArchiveCommands,
	parseNativeArchiveListing,
} from '../../../../platform/archive/adapters/native/archive-commands.js';
import { NativeArchiveFailure, type NativeArchiveOperationOutcome } from '../../../../platform/archive/archive-port.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { FileCommandNotStarted, RemoteFileFailure, type FileResource } from './file-types.js';
import {
	ArchiveRejection,
	type ArchiveFormat,
	type FileArchiveOperation,
	type FileArchiveCommandOutcome,
	type FileArchiveCompression,
	type FileArchiveExtraction,
	type FileArchiveExtractionPlan,
	type FileArchiveListing,
} from './file-task-types.js';

/** Native syntax stays in Adapter; Service consumes application archive facts. */
export class FileArchiveModel {
	private readonly commands: NativeArchiveCommands;

	constructor(resource: FileResource) {
		this.commands = new NativeArchiveCommands({
			executeLines: async (command, signal, timeoutMs, onLine, beforeWriteMarker) => {
				const result = await resource.executeCommandLines(
					command,
					signal,
					timeoutMs,
					onLine,
					beforeWriteMarker,
				);
				return result.status === 'completed'
					? { status: 'completed' }
					: { status: 'nonzero', exitCode: result.exitCode };
			},
		});
	}

	private async perform<T>(action: () => Promise<T>): Promise<T> {
		try {
			return await action();
		} catch (cause) {
			if (!(cause instanceof NativeArchiveFailure)) {
				throw cause;
			}
			if (cause.reason === 'cleanup_failed') {
				throw new RemoteResourceCleanupFailure([cause]);
			}
			if (cause.reason === 'missing_tool') {
				throw new ArchiveRejection('COMMAND_NOT_FOUND', cause.tool);
			}
			if (cause.reason === 'password_required' || cause.reason === 'invalid_password') {
				throw new ArchiveRejection(
					cause.reason === 'password_required' ? 'PASSWORD_REQUIRED' : 'INVALID_PASSWORD',
				);
			}
			throw new RemoteFileFailure(
				cause.reason === 'limit_exceeded'
					? 'limit_exceeded'
					: cause.reason === 'rejected'
						? 'remote_unavailable'
						: 'operation_unknown',
				{ cause },
			);
		}
	}

	async prepare(
		format: ArchiveFormat,
		operation: FileArchiveOperation,
		remaining: () => number,
		signal: AbortSignal,
	): Promise<void> {
		try {
			await this.perform(() =>
				this.commands.requireTools(
					archiveToolRequirements(format, operation).map((tool) => tool),
					remaining,
					signal,
				),
			);
		} catch (cause) {
			// Only the read-only lookup was dispatched; a lost reply cannot leave an archive writer.
			if (cause instanceof RemoteFileFailure && cause.code === 'operation_unknown') {
				throw new FileCommandNotStarted({ cause });
			}
			throw cause;
		}
	}

	list(
		archive: string,
		format: ArchiveFormat,
		remaining: () => number,
		signal: AbortSignal,
	): Promise<FileArchiveListing> {
		return this.perform(async () => {
			const listing = await this.commands.list(archive, format, remaining, signal);
			const parsed = parseNativeArchiveListing(listing.names, listing.modes, format);
			return {
				names: parsed.names.map((name) => name),
				modes: parsed.modes.map((member) => ({
					name: member.name,
					kind: member.kind,
					size: member.size,
					mode: member.mode,
					linkTarget: member.linkTarget,
				})),
			};
		});
	}

	private outcome(value: NativeArchiveOperationOutcome): FileArchiveCommandOutcome {
		if (value.status === 'completed') {
			return { status: 'completed' };
		}
		if (value.reason === 'missing_tool') {
			return { status: 'rejected', failure: new ArchiveRejection('COMMAND_NOT_FOUND', value.tool) };
		}
		if (value.reason === 'password_required' || value.reason === 'invalid_password') {
			return {
				status: 'rejected',
				failure: new ArchiveRejection(
					value.reason === 'password_required' ? 'PASSWORD_REQUIRED' : 'INVALID_PASSWORD',
				),
			};
		}
		return {
			status: 'rejected',
			failure: new RemoteFileFailure(value.reason === 'limit_exceeded' ? 'limit_exceeded' : 'remote_unavailable'),
		};
	}

	compress(
		workingDirectory: string,
		paths: readonly string[],
		temporary: string,
		excluded: readonly string[],
		format: ArchiveFormat,
		remaining: () => number,
		signal: AbortSignal,
		onProgress: (count: number, totalFiles?: number, processedBytes?: number) => void,
		password?: string,
	): Promise<FileArchiveCompression> {
		return this.perform(async () => {
			const result = await this.commands.compress(
				workingDirectory,
				paths.map((name) => name),
				temporary,
				excluded.map((name) => name),
				format,
				remaining,
				signal,
				(count, totalFiles, processedBytes) => onProgress(count, totalFiles, processedBytes),
				password,
			);
			return {
				outcome: this.outcome(result.outcome),
				count: result.count,
				finished: result.finished,
				writerExited: result.writerExited,
			};
		});
	}

	extract(
		plan: FileArchiveExtractionPlan,
		remaining: () => number,
		signal: AbortSignal,
		onProgress: (processedBytes: number) => void,
		password?: string,
	): Promise<FileArchiveExtraction> {
		return this.perform(async () => {
			const result = await this.commands.extract(
				{
					snapshot: plan.snapshot,
					stage: plan.stage,
					format: plan.format,
					excludedMembers: plan.excludedMembers.map((name) => name),
					hasContent: plan.hasContent,
				},
				remaining,
				signal,
				(processedBytes) => onProgress(processedBytes),
				password,
			);
			return {
				outcome: this.outcome(result.outcome),
				done: result.done,
			};
		});
	}

	readZipLinkTarget(
		snapshot: string,
		name: string,
		remaining: () => number,
		signal: AbortSignal,
		password?: string,
	): Promise<string> {
		return this.perform(() => this.commands.readZipLinkTarget(snapshot, name, remaining, signal, password));
	}

	createHardlink(
		stage: string,
		target: string,
		name: string,
		remaining: () => number,
		signal: AbortSignal,
	): Promise<FileArchiveCommandOutcome> {
		return this.perform(async () =>
			this.outcome(await this.commands.createHardlink(stage, target, name, remaining, signal)),
		);
	}

	verifyZip(temporary: string, remaining: () => number, signal: AbortSignal): Promise<boolean> {
		return this.perform(() => this.commands.verifyZip(temporary, remaining, signal));
	}

	copySnapshot(
		source: string,
		snapshot: string,
		remaining: () => number,
		signal: AbortSignal,
	): Promise<FileArchiveCommandOutcome> {
		return this.perform(async () => {
			const result = await this.commands.copySnapshot(source, snapshot, remaining, signal);
			return this.outcome(result);
		});
	}
}
