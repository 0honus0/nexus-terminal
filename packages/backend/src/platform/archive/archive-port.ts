/** Technical command facts; no Remote, Targets or Shared application objects. */
export type NativeArchiveFormat = 'zip' | 'tar.gz' | 'tar.bz2';

export type NativeCommandOutcome = { status: 'completed' } | { status: 'nonzero'; exitCode: number };

export interface ArchiveCommandRunner {
	executeLines(
		command: string,
		signal: AbortSignal,
		timeoutMs: number,
		onLine: (line: string) => void,
		beforeWriteMarker?: string,
	): Promise<NativeCommandOutcome>;
}

export interface NativeArchiveListing {
	names: string;
	modes: string;
}

export interface NativeArchiveMember {
	name: string;
	kind: 'file' | 'directory' | 'symlink' | 'hardlink' | 'special';
	size: number;
	/** Null when the archive stores no POSIX permission metadata. */
	mode: number | null;
	/** TAR link target; ZIP stores it in the member payload. */
	linkTarget: string | null;
}

export class NativeArchiveFailure extends Error {
	constructor(
		readonly reason:
			| 'missing_tool'
			| 'invalid_output'
			| 'cleanup_failed'
			| 'limit_exceeded'
			| 'rejected'
			| 'password_required'
			| 'invalid_password',
		readonly tool?: string,
		options?: ErrorOptions,
	) {
		super('Native archive ' + reason, options);
		this.name = 'NativeArchiveFailure';
	}
}

export type ZipSourceEntry =
	{ kind: 'directory'; name: string } | { kind: 'file'; name: string; bytes: AsyncIterable<Uint8Array> };

export class ZipStreamFailure extends Error {
	constructor(options?: ErrorOptions) {
		super('ZIP stream failed', options);
		this.name = 'ZipStreamFailure';
	}
}

export type NativeArchiveOperationOutcome =
	| { status: 'completed' }
	| { status: 'rejected'; reason: 'missing_tool'; tool: string }
	| { status: 'rejected'; reason: 'limit_exceeded' | 'rejected' | 'password_required' | 'invalid_password' };

export interface NativeArchiveCompression {
	outcome: NativeArchiveOperationOutcome;
	count: number;
	finished: boolean;
	writerExited: boolean;
}

export interface NativeArchiveExtraction {
	outcome: NativeArchiveOperationOutcome;
	done: boolean;
}

export interface NativeArchiveMembers {
	names: string[];
	modes: NativeArchiveMember[];
}

export interface NativeArchiveExtractionPlan {
	snapshot: string;
	stage: string;
	format: NativeArchiveFormat;
	excludedMembers: readonly string[];
	hasContent: boolean;
}
