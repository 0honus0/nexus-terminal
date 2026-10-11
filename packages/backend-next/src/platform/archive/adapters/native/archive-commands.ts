import { NativeArchiveFailure, type NativeArchiveMember } from '../../archive-port.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
	ArchiveCommandRunner,
	NativeArchiveFormat,
	NativeArchiveListing,
	NativeArchiveCompression,
	NativeArchiveExtraction,
	NativeArchiveExtractionPlan,
	NativeCommandOutcome,
	NativeArchiveOperationOutcome,
	NativeArchiveMembers,
} from '../../archive-port.js';

const MAX_LISTING_BYTES = 8 * 1024 * 1024;
// POSIX sh uses 512-byte units; some shells use 1024. Both must accommodate
// the decoded budget while bounding each remote metadata file before reading it.
const LISTING_FILE_LIMIT_BLOCKS = MAX_LISTING_BYTES / 512;

function quote(value: string): string {
	return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function shell(script: string): string {
	return 'sh -c ' + quote(script);
}

/** Info-ZIP arguments are patterns even when shell-quoted. */
function zipLiteral(value: string): string {
	return value.replace(/[\\*?\[\]]/gu, '\\$&');
}

interface ListingCleanupResult {
	operationExitCode: number;
	cleanupExitCode: number;
}

function listingCleanupFailure(result: ListingCleanupResult): NativeArchiveFailure {
	const failures: unknown[] = [new Error('Archive listing cleanup exit code: ' + result.cleanupExitCode)];
	if (result.operationExitCode !== 0) {
		failures.unshift(new Error('Archive listing exit code: ' + result.operationExitCode));
	}
	return new NativeArchiveFailure('cleanup_failed', undefined, {
		cause: new AggregateError(failures, 'Archive listing cleanup failed'),
	});
}

export class NativeArchiveCommands {
	constructor(private readonly runner: ArchiveCommandRunner) {}

	async list(
		archive: string,
		format: NativeArchiveFormat,
		remaining: () => number,
		signal: AbortSignal,
	): Promise<NativeArchiveListing> {
		const directory = path.posix.dirname(archive);
		const suffix = randomUUID();
		const names = path.posix.join(directory, '.nexus-archive-list-' + suffix + '.part');
		const modes = path.posix.join(directory, '.nexus-archive-mode-' + suffix + '.part');
		const isZip = format === 'zip';
		const flag = format === 'tar.gz' ? 'z' : 'j';
		// GNU tar strips leading '/' from names unless -P is used. Listing with
		// --absolute-names ensures an absolute archive member remains visible to
		// the validation code instead of being silently normalized.
		const listing = isZip
			? 'unzip -Z -1 -- ' + quote(archive)
			: 'tar --absolute-names -t' + flag + 'f ' + quote(archive) + ' --quoting-style=literal';
		const verbose = isZip
			? 'zipinfo -l -- ' + quote(archive)
			: 'tar --absolute-names -tv' + flag + 'f ' + quote(archive) + ' --quoting-style=literal';
		const script = [
			'umask 077',
			'ulimit -f ' + LISTING_FILE_LIMIT_BLOCKS + ' || exit 78',
			'LC_MESSAGES=C; export LC_MESSAGES',
			'command -v ' + (isZip ? 'unzip' : 'tar') + ' >/dev/null 2>&1 || exit 127',
			'command -v od >/dev/null 2>&1 || { ' + "printf 'NEXUS_ARCHIVE_MISSING:od\\n'; exit 127; }",
			...(isZip
				? [
						'command -v zipinfo >/dev/null 2>&1 || { ' +
							"printf 'NEXUS_ARCHIVE_MISSING:zipinfo\\n'; exit 127; }",
					]
				: []),
			'trap ' +
				quote(
					'archive_status=$?; rm -f -- ' +
						quote(names) +
						' ' +
						quote(modes) +
						'; archive_cleanup_status=$?; if [ "$archive_cleanup_status" -ne 0 ]; then ' +
						'printf \'NEXUS_ARCHIVE_CLEANUP:%s:%s\\n\' "$archive_status" "$archive_cleanup_status"; exit 79; fi; ' +
						'exit "$archive_status"',
				) +
				' EXIT',
			listing + ' > ' + quote(names) + ' || exit 78',
			verbose + ' > ' + quote(modes) + ' || exit 78',
			"printf 'NEXUS_ARCHIVE_SECTION:NAMES\\n'",
			'od -An -v -tx1 ' + quote(names) + ' || exit 78',
			"printf 'NEXUS_ARCHIVE_SECTION:MODES\\n'",
			'od -An -v -tx1 ' + quote(modes) + ' || exit 78',
			"printf 'NEXUS_ARCHIVE_COUNT:0\\n'",
		].join('\n');
		const nameBytes: number[] = [];
		const modeBytes: number[] = [];
		let done = false;
		let section: 'names' | 'modes' | null = null;
		let missing: string | undefined;
		let cleanupFailure: ListingCleanupResult | null = null;
		try {
			const outcome = await this.runner.executeLines(shell(script), signal, remaining(), (line) => {
				const cleanup = /^NEXUS_ARCHIVE_CLEANUP:(\d{1,3}):(\d{1,3})$/u.exec(line);
				if (
					cleanup &&
					!cleanupFailure &&
					Number(cleanup[1]) <= 255 &&
					Number(cleanup[2]) >= 1 &&
					Number(cleanup[2]) <= 255
				) {
					cleanupFailure = { operationExitCode: Number(cleanup[1]), cleanupExitCode: Number(cleanup[2]) };
					return;
				}
				if (cleanupFailure) {
					throw new NativeArchiveFailure('invalid_output');
				}
				const missingMatch = /^NEXUS_ARCHIVE_MISSING:(zipinfo|od)$/u.exec(line);
				if (missingMatch && !done && !missing && (isZip || missingMatch[1] !== 'zipinfo')) {
					missing = missingMatch[1];
					return;
				}
				if (line === 'NEXUS_ARCHIVE_SECTION:NAMES' && section === null && !done && !missing) {
					section = 'names';
					return;
				}
				if (line === 'NEXUS_ARCHIVE_SECTION:MODES' && section === 'names' && !done && !missing) {
					section = 'modes';
					return;
				}
				if (line === 'NEXUS_ARCHIVE_COUNT:0' && section === 'modes' && !done && !missing) {
					done = true;
					return;
				}
				if (!/^\s+[0-9a-f]{2}(?:\s+[0-9a-f]{2}){0,15}\s*$/u.test(line) || section === null || done || missing) {
					throw new NativeArchiveFailure('invalid_output');
				}
				const buffer = section === 'names' ? nameBytes : modeBytes;
				const hex = line.trim().split(/\s+/u);
				if (buffer.length + hex.length > MAX_LISTING_BYTES) {
					throw new NativeArchiveFailure('limit_exceeded');
				}
				for (const value of hex) {
					buffer.push(Number.parseInt(value, 16));
				}
			});
			if (cleanupFailure !== null) {
				throw listingCleanupFailure(cleanupFailure);
			}
			if (outcome.status === 'nonzero') {
				if (outcome.exitCode === 127) {
					throw new NativeArchiveFailure('missing_tool', isZip ? 'unzip' : 'tar');
				}
				throw new NativeArchiveFailure('rejected');
			}
		} catch (cause) {
			if (
				cleanupFailure !== null &&
				!(cause instanceof NativeArchiveFailure && cause.reason === 'cleanup_failed')
			) {
				throw new NativeArchiveFailure('cleanup_failed', undefined, {
					cause: new AggregateError([cause, listingCleanupFailure(cleanupFailure)], 'Archive listing failed'),
				});
			}
			if (missing && cause instanceof NativeArchiveFailure && cause.reason === 'missing_tool') {
				throw new NativeArchiveFailure('missing_tool', missing);
			}
			throw cause;
		}
		if (!done) {
			throw new NativeArchiveFailure('invalid_output');
		}

		try {
			const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
			return {
				names: decoder.decode(Uint8Array.from(nameBytes)),
				modes: decoder.decode(Uint8Array.from(modeBytes)),
			};
		} catch (cause) {
			throw new NativeArchiveFailure('invalid_output', undefined, { cause });
		}
	}

	async compress(
		workingDirectory: string,
		paths: readonly string[],
		temporary: string,
		excluded: readonly string[],
		format: NativeArchiveFormat,
		maxEntries: number,
		remaining: () => number,
		signal: AbortSignal,
		onProgress: (count: number) => void,
		password?: string,
	): Promise<NativeArchiveCompression> {
		const tool = format === 'zip' ? 'zip' : 'tar';
		const args = paths.map((source) => quote('./' + path.posix.relative(workingDirectory, source)));
		const native =
			format === 'zip'
				? 'zip -yr ' +
					(password === undefined ? '' : '-P ' + quote(password) + ' ') +
					quote(temporary) +
					' ' +
					args.join(' ') +
					' -x ' +
					excluded.flatMap((name) => [quote(zipLiteral(name)), quote(zipLiteral('./' + name))]).join(' ')
				: 'tar --no-wildcards --anchored ' +
					excluded.map((name) => '--exclude=' + quote('./' + name)).join(' ') +
					' -c' +
					(format === 'tar.gz' ? 'z' : 'j') +
					'vf ' +
					quote(temporary) +
					' -- ' +
					args.join(' ');
		const sentinel = 'NEXUS_NATIVE_STATUS_' + randomUUID().replaceAll('-', '') + ':';
		const script = [
			'command -v ' + tool + ' >/dev/null 2>&1 || exit 127',
			'LC_MESSAGES=C; export LC_MESSAGES',
			'cd ' + quote(workingDirectory) + ' || exit 78',
			'umask 077',
			'(' + native + ' 2>&1; printf ' + quote(sentinel + '%s\n') + ' "$?") |',
			'{ count=0; overflow=0; while IFS= read -r line; do',
			'  case "$line" in',
			'    ' + quote(sentinel) + '*)',
			'      status=${line#*:}',
			"      printf 'NEXUS_ARCHIVE_EXIT\\n'",
			'      if [ "$overflow" = 1 ]; then exit 79; fi',
			'      if [ "$status" = 0 ]; then printf ' +
				quote('NEXUS_ARCHIVE_COUNT:%s\n') +
				' "$count"; else exit "$status"; fi',
			'      ;;',
			format === 'zip' ? "    '  adding: '*)" : "    './'*)",
			'      if [ "$count" -ge ' + maxEntries + ' ]; then overflow=1; continue; fi',
			'      count=$((count + 1))',
			'      printf ' + quote('NEXUS_ARCHIVE_PROGRESS:%s\n') + ' "$count"',
			'      ;;',
			'  esac',
			'done; }',
		].join('\n');
		let count = 0;
		let finished = false;
		let writerExited = false;
		const outcome = await this.runner.executeLines(shell(script), signal, remaining(), (line) => {
			const progress = /^NEXUS_ARCHIVE_PROGRESS:(\d+)$/u.exec(line);
			const end = /^NEXUS_ARCHIVE_COUNT:(\d+)$/u.exec(line);
			if (line === 'NEXUS_ARCHIVE_EXIT' && !writerExited && !finished) {
				writerExited = true;
			} else if (
				progress &&
				!writerExited &&
				!finished &&
				Number(progress[1]) === count + 1 &&
				count < maxEntries
			) {
				count++;
				onProgress(count);
			} else if (end && writerExited && !finished && Number(end[1]) === count) {
				finished = true;
			} else {
				throw new NativeArchiveFailure('invalid_output');
			}
		});

		return { outcome: normalizeOutcome(outcome, tool), count, finished, writerExited };
	}

	async extract(
		plan: NativeArchiveExtractionPlan,
		remaining: () => number,
		signal: AbortSignal,
		password?: string,
	): Promise<NativeArchiveExtraction> {
		const { snapshot, stage, format, excludedMembers } = plan;
		const tool = format === 'zip' ? 'unzip' : 'tar';
		const native =
			format === 'zip'
				? 'unzip -oq ' +
					(password === undefined ? '' : '-P ' + quote(password) + ' ') +
					'-- ' +
					quote(snapshot) +
					' -d ' +
					quote(stage) +
					(excludedMembers.length
						? ' -x ' + excludedMembers.map((name) => quote(zipLiteral(name))).join(' ')
						: '')
				: 'tar --no-same-owner --same-permissions --no-overwrite-dir --no-wildcards --anchored ' +
					[...new Set(excludedMembers.flatMap((name) => [name, path.posix.normalize(name)]))]
						.map((name) => '--exclude=' + quote(name))
						.join(' ') +
					' -x' +
					(format === 'tar.gz' ? 'z' : 'j') +
					'f ' +
					quote(snapshot) +
					' -C ' +
					quote(stage);
		const requiredTools = format === 'zip' ? ['unzip', 'zipinfo', 'grep'] : ['tar'];
		const script = [
			'for archive_tool in ' +
				requiredTools.join(' ') +
				'; do command -v "$archive_tool" >/dev/null 2>&1 || { ' +
				'printf \'NEXUS_ARCHIVE_MISSING:%s\\n\' "$archive_tool"; exit 127; }; done',
			'LC_MESSAGES=C; export LC_MESSAGES',
			'umask 077',
			...(format === 'zip'
				? [
						...(password === undefined
							? [
									'if zipinfo -v -- ' +
										quote(snapshot) +
										" | grep -Eq 'file security status:[[:space:]]*encrypted'; then " +
										"printf 'NEXUS_ARCHIVE_ERROR:PASSWORD_REQUIRED\\n'; exit 82; fi",
								]
							: [
									'unzip -tq -P ' +
										quote(password) +
										' -- ' +
										quote(snapshot) +
										' >/dev/null 2>&1 || { code=$?; ' +
										'if [ "$code" -eq 82 ]; then printf \'NEXUS_ARCHIVE_ERROR:INVALID_PASSWORD\\n\'; exit 82; fi; ' +
										'exit 78; }',
								]),
					]
				: []),
			'mkdir -m 700 -- ' + quote(stage) + ' || exit 78',
			...(plan.hasContent ? [native + ' >/dev/null 2>&1 || exit 78'] : []),
			"printf 'NEXUS_ARCHIVE_COUNT:0\\n'",
		].join('\n');
		let done = false;
		let passwordError: 'password_required' | 'invalid_password' | null = null;
		let missingTool: string | null = null;
		const outcome = await this.runner.executeLines(shell(script), signal, remaining(), (line) => {
			const missing = /^NEXUS_ARCHIVE_MISSING:([a-z]+)$/u.exec(line);
			if (missing && !done && !passwordError && !missingTool && requiredTools.includes(missing[1] ?? '')) {
				missingTool = missing[1] ?? null;
			} else if (line === 'NEXUS_ARCHIVE_COUNT:0' && !done && !passwordError && !missingTool) {
				done = true;
			} else if (line === 'NEXUS_ARCHIVE_ERROR:PASSWORD_REQUIRED' && !done && !missingTool) {
				passwordError = 'password_required';
			} else if (line === 'NEXUS_ARCHIVE_ERROR:INVALID_PASSWORD' && !done && !missingTool) {
				passwordError = 'invalid_password';
			} else {
				throw new NativeArchiveFailure('invalid_output');
			}
		});
		return { outcome: normalizeOutcome(outcome, missingTool ?? tool, passwordError), done };
	}

	async readZipLinkTarget(
		snapshot: string,
		name: string,
		remaining: () => number,
		signal: AbortSignal,
		password?: string,
	): Promise<string> {
		const marker = '\nNEXUS_LINK_' + randomUUID().replaceAll('-', '') + ':';
		const script = [
			'command -v unzip >/dev/null 2>&1 || exit 127',
			'command -v od >/dev/null 2>&1 || exit 126',
			'LC_MESSAGES=C; export LC_MESSAGES',
			'(unzip -p ' +
				(password === undefined ? '' : '-P ' + quote(password) + ' ') +
				'-- ' +
				quote(snapshot) +
				' ' +
				quote(zipLiteral(name)) +
				'; code=$?; printf ' +
				quote(marker + '%s\n') +
				' "$code") | od -An -v -tx1',
		].join('\n');
		const bytes: number[] = [];
		const outcome = await this.runner.executeLines(shell(script), signal, remaining(), (line) => {
			if (!/^\s+[0-9a-f]{2}(?:\s+[0-9a-f]{2}){0,15}\s*$/u.test(line)) {
				throw new NativeArchiveFailure('invalid_output');
			}
			const chunk = line.trim().split(/\s+/u);
			if (bytes.length + chunk.length > 4096 + marker.length + 16) {
				throw new NativeArchiveFailure('limit_exceeded');
			}
			for (const byte of chunk) {
				bytes.push(Number.parseInt(byte, 16));
			}
		});
		if (outcome.status !== 'completed') {
			throw new NativeArchiveFailure(
				outcome.exitCode === 127 || outcome.exitCode === 126 ? 'missing_tool' : 'rejected',
				outcome.exitCode === 126 ? 'od' : 'unzip',
			);
		}
		let decoded: string;
		try {
			decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes));
		} catch (cause) {
			throw new NativeArchiveFailure('invalid_output', undefined, { cause });
		}
		const separator = decoded.lastIndexOf(marker);
		const status = decoded.slice(separator + marker.length);
		if (separator < 0 || !/^\d+\n$/u.test(status)) {
			throw new NativeArchiveFailure('invalid_output');
		}
		if (Number(status) !== 0) {
			throw new NativeArchiveFailure(
				Number(status) === 82
					? password === undefined
						? 'password_required'
						: 'invalid_password'
					: 'rejected',
			);
		}
		const target = decoded.slice(0, separator);
		if (Buffer.byteLength(target, 'utf8') > 4096) {
			throw new NativeArchiveFailure('limit_exceeded');
		}
		return target;
	}

	async createHardlink(
		stage: string,
		target: string,
		name: string,
		remaining: () => number,
		signal: AbortSignal,
	): Promise<NativeArchiveOperationOutcome> {
		const outcome = await this.runner.executeLines(
			shell(
				'command -v ln >/dev/null 2>&1 || exit 127\nln -P -- ' +
					quote(path.posix.join(stage, target)) +
					' ' +
					quote(path.posix.join(stage, name)),
			),
			signal,
			remaining(),
			() => {
				throw new NativeArchiveFailure('invalid_output');
			},
		);
		return normalizeOutcome(outcome, 'ln');
	}

	async verifyZip(temporary: string, remaining: () => number, signal: AbortSignal): Promise<boolean> {
		const outcome = await this.runner.executeLines(
			shell('zip -T ' + quote(temporary) + ' >/dev/null 2>&1'),
			signal,
			remaining(),
			() => {
				throw new NativeArchiveFailure('invalid_output');
			},
		);
		return outcome.status === 'completed';
	}

	async copySnapshot(
		source: string,
		snapshot: string,
		remaining: () => number,
		signal: AbortSignal,
	): Promise<NativeArchiveOperationOutcome> {
		const result = await this.runner.executeLines(
			shell(
				'umask 077\ncommand -v cp >/dev/null 2>&1 || exit 127\ncp --reflink=auto --no-dereference -- ' +
					quote(source) +
					' ' +
					quote(snapshot),
			),
			signal,
			remaining(),
			() => {
				throw new NativeArchiveFailure('invalid_output');
			},
		);
		return normalizeOutcome(result, 'cp');
	}
}

export function parseNativeArchiveListing(
	namesText: string,
	modesText: string,
	format: NativeArchiveFormat,
): NativeArchiveMembers {
	const names =
		namesText === '' ? [] : namesText.endsWith('\n') ? namesText.slice(0, -1).split('\n') : namesText.split('\n');
	const modes: NativeArchiveMember[] = [];
	for (const line of modesText.split('\n')) {
		if (!line) {
			continue;
		}
		if (
			format === 'zip' &&
			(/^Archive:/u.test(line) || /^Zip file size:/u.test(line) || /^\d+ files?,/u.test(line))
		) {
			continue;
		}
		const attribute = /^([^\s]+)\s+\S+\s+(\S+)\s/u.exec(line);
		if (!attribute) {
			if (format !== 'zip') {
				throw new NativeArchiveFailure('invalid_output');
			}
			continue;
		}
		const permissions = attribute[1] ?? '';
		const posix = /^[\-dlhcbps][r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/u.test(permissions);
		const dos = format === 'zip' && /^[\-d][r-][w-][x-][a-][h-][s-]$/u.test(permissions);
		if (!posix && !dos) {
			throw new NativeArchiveFailure('invalid_output');
		}
		const mode = posix && (format !== 'zip' || attribute[2] === 'unx') ? decodePermissions(permissions) : null;
		const sizeMatch =
			format === 'zip'
				? /^\S+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/u.exec(line)
				: /^\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/u.exec(line);
		if (!sizeMatch) {
			throw new NativeArchiveFailure('invalid_output');
		}
		// Listing and verbose metadata must describe the *same entry*, not
		// merely the same number of entries. Otherwise a reordered or
		// malformed archive could assign a regular-file type to a link.
		let listedName = sizeMatch[2];
		let linkTarget: string | null = null;
		if (format !== 'zip' && (permissions[0] === 'l' || permissions[0] === 'h')) {
			const name = names[modes.length];
			const prefix = name === undefined ? null : name + (permissions[0] === 'l' ? ' -> ' : ' link to ');
			if (prefix === null || !listedName?.startsWith(prefix)) {
				throw new NativeArchiveFailure('invalid_output');
			}
			linkTarget = listedName.slice(prefix.length);
			listedName = name;
		}
		if (listedName === undefined) {
			throw new NativeArchiveFailure('invalid_output');
		}
		const size = Number(sizeMatch[1]);
		if (!Number.isSafeInteger(size)) {
			throw new NativeArchiveFailure('limit_exceeded');
		}
		const kind = decodeMemberKind(permissions);
		modes.push({ name: listedName, kind, size, mode, linkTarget });
	}

	return { names, modes };
}

function decodeMemberKind(permissions: string): NativeArchiveMember['kind'] {
	switch (permissions[0]) {
		case 'd':
			return 'directory';
		case '-':
			return 'file';
		case 'l':
			return 'symlink';
		case 'h':
			return 'hardlink';
		default:
			return 'special';
	}
}

function decodePermissions(value: string): number {
	let mode = 0;
	for (const offset of [1, 4, 7]) {
		const shift = 7 - offset;
		if (value[offset] === 'r') {
			mode |= 4 << shift;
		}
		if (value[offset + 1] === 'w') {
			mode |= 2 << shift;
		}
		if (/[xst]/u.test(value[offset + 2] ?? '')) {
			mode |= 1 << shift;
		}
	}
	if (/[sS]/u.test(value[3] ?? '')) {
		mode |= 0o4000;
	}
	if (/[sS]/u.test(value[6] ?? '')) {
		mode |= 0o2000;
	}
	if (/[tT]/u.test(value[9] ?? '')) {
		mode |= 0o1000;
	}
	return mode;
}

function normalizeOutcome(
	value: NativeCommandOutcome,
	tool: string,
	passwordError: 'password_required' | 'invalid_password' | null = null,
): NativeArchiveOperationOutcome {
	if (value.status === 'completed') {
		if (passwordError !== null) {
			throw new NativeArchiveFailure('invalid_output');
		}
		return { status: 'completed' };
	}
	if (value.exitCode === 127) {
		return { status: 'rejected', reason: 'missing_tool', tool };
	}
	if (value.exitCode === 79) {
		return { status: 'rejected', reason: 'limit_exceeded' };
	}
	if (value.exitCode === 82 && passwordError !== null) {
		return { status: 'rejected', reason: passwordError };
	}
	return { status: 'rejected', reason: 'rejected' };
}
