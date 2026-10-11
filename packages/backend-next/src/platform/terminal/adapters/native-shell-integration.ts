import { TerminalCleanupFailure } from '../terminal-errors.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
	ShellIntegrationPort,
	ShellIntegrationFactory,
	ShellIntegrationOptions,
} from '../shell-integration-port.js';
type WorkspaceShellKind = 'bash' | 'zsh' | 'other';
interface Setup {
	kind: 'probe' | 'hook';
	start: Buffer;
	end: Buffer;
	buffer: Buffer;
	capturing: boolean;
	timer: ReturnType<typeof setTimeout>;
	resolve(): void;
	reject(error: Error): void;
}

const CLEAR_LINE = Buffer.from('\r\x1b[2K', 'ascii');
const SETUP_TIMEOUT_MS = 5000;
const MAX_SETUP_BYTES = 4096;

const marker = (prefix: string): string => '__NEXUS_' + prefix + '_' + randomUUID().replace(/-/gu, '') + '__';

const quote = (value: string): string => "'" + value.replace(/'/gu, "'\\''") + "'";

const octal = (value: string): string =>
	[...value].map((c) => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')).join('');

function cleanHistory(kind: WorkspaceShellKind, token: string): string {
	if (kind === 'bash') {
		return (
			'case "$(builtin history 1 2>/dev/null)" in *' +
			quote(token) +
			'*) builtin history -d "$HISTCMD" 2>/dev/null || true ;; esac;'
		);
	}
	if (kind === 'zsh') {
		return (
			'zmodload zsh/parameter 2>/dev/null && case "${history[$HISTCMD]-}" in *' +
			quote(token) +
			'*) unset "history[$HISTCMD]" 2>/dev/null ;; esac || true;'
		);
	}
	return ':;';
}

function probeHistoryCleanup(token: string): string {
	return [
		'case "$__nexus_kind" in',
		'bash) ' + cleanHistory('bash', token) + ' ;;',
		'zsh) ' + cleanHistory('zsh', token) + ' ;;',
		'esac;',
	].join(' ');
}

function parseAbsolute(value: string): string {
	const begin = value.indexOf('\0');
	const end = begin >= 0 ? value.indexOf('\0', begin + 1) : -1;
	if (begin < 0 || end < 0) {
		throw new Error('Shell directory command omitted delimiters');
	}
	const directory = value.slice(begin + 1, end);
	if (!directory.startsWith('/')) {
		throw new Error('Shell directory command returned a relative path');
	}
	return directory;
}

function partialSuffix(data: Buffer, token: Buffer): number {
	for (let length = Math.min(data.length, token.length - 1); length > 0; length -= 1) {
		if (data.subarray(-length).equals(token.subarray(0, length))) {
			return length;
		}
	}
	return 0;
}

class NativeShellIntegration implements ShellIntegrationPort {
	private pid: number | null = null;
	private readonly promptMarker = Buffer.from(
		'\x1b]777;NEXUS_PROMPT_' + randomUUID().replace(/-/gu, '') + '\x07',
		'ascii',
	);
	private kind: WorkspaceShellKind = 'other';
	private atPrompt = false;
	private ready = false;
	private closed = false;
	private setup: Setup | null = null;
	private probeTask: Promise<void> | null = null;
	private hookTask: Promise<void> | null = null;
	private markerRemainder = Buffer.alloc(0);
	private suppressUntilPrompt = false;
	private userInputSeen = false;

	constructor(private readonly options: ShellIntegrationOptions) {}

	private write(bytes: Uint8Array): void {
		this.options.write(bytes);
	}

	private execute(command: string, signal?: AbortSignal): Promise<string> {
		return this.options.execute(command, signal);
	}

	get isAtPrompt(): boolean {
		return this.atPrompt;
	}

	noteUserInput(): void {
		// Any unverified foreground program may now own the PTY. Never inject
		// a discovery/setup command after ordinary terminal input has begun.
		this.userInputSeen = true;
		this.atPrompt = false;
	}

	onAttachmentReleased(): void {
		this.userInputSeen = true;
		this.atPrompt = false;
		this.suppressUntilPrompt = false;
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new Error('Shell integration closed');
		}
	}

	async currentDirectory(signal?: AbortSignal): Promise<string> {
		await this.ensureProbe();
		this.assertOpen();
		const pid = this.pid;
		if (!pid) {
			throw new Error('Interactive shell PID unavailable');
		}
		const result = await this.execute(
			"printf '\\000'; readlink -n /proc/" + pid + '/cwd; status=$?; printf \'\\000\'; exit "$status"',
			signal,
		);
		const current = parseAbsolute(result);
		if (!current.endsWith(' (deleted)')) {
			return current;
		}
		let parent = path.posix.dirname(current.slice(0, -' (deleted)'.length) || '/');
		while (true) {
			try {
				return await this.resolveDirectory(parent, signal);
			} catch (error) {
				signal?.throwIfAborted();
				if (error instanceof TerminalCleanupFailure) {
					throw error;
				}
				if (parent === '/') {
					break;
				}
				parent = path.posix.dirname(parent);
			}
		}
		throw new Error('Shell directory was deleted');
	}

	async resolveDirectory(value: string, signal?: AbortSignal): Promise<string> {
		this.assertOpen();
		return parseAbsolute(
			await this.execute('cd -P ' + quote(value) + ' 2>/dev/null && printf \'\\000%s\\000\' "$PWD"', signal),
		);
	}

	async ensureProbe(): Promise<void> {
		this.assertOpen();
		if (this.pid !== null) {
			return;
		}
		if (this.probeTask) {
			return this.probeTask;
		}
		if (this.userInputSeen) {
			throw new Error('Interactive shell discovery unavailable after foreground input');
		}
		const start = marker('SHELL_BEGIN');
		const end = marker('SHELL_END');
		const historyToken = marker('INTERNAL_PROBE');
		this.probeTask = this.startSetup(
			'probe',
			start,
			end,
			[
				'stty -echo 2>/dev/null;',
				'if [ -n "${BASH_VERSION-}" ]; then __nexus_kind=bash; elif [ -n "${ZSH_VERSION-}" ]; then __nexus_kind=zsh; else __nexus_kind=other; fi;',
				"printf '\\n" + octal(start) + '%s:%s' + octal(end) + '\\n\' "$$" "$__nexus_kind";',
				': ' + quote(historyToken) + ';',
				probeHistoryCleanup(historyToken),
				'stty echo 2>/dev/null;',
			].join(' ') + '\r',
		).finally(() => {
			this.probeTask = null;
		});
		return this.probeTask;
	}

	async ensureHook(): Promise<void> {
		await this.ensureProbe();
		if (this.ready) {
			return;
		}
		if (this.hookTask) {
			return this.hookTask;
		}
		if (this.userInputSeen) {
			throw new Error('Prompt hook setup unavailable after foreground input');
		}
		if (this.kind !== 'bash' && this.kind !== 'zsh') {
			throw new Error('Shell does not support a prompt-safe directory queue');
		}
		const start = marker('HOOK_BEGIN');
		const end = marker('HOOK_END');
		const historyToken = marker('INTERNAL_HOOK');
		const functionBody = "__nexus_prompt_marker(){ printf '" + octal(this.promptMarker.toString('ascii')) + "'; };";
		const hook =
			this.kind === 'bash'
				? [
						functionBody,
						"if declare -p PROMPT_COMMAND 2>/dev/null | grep -q 'declare -a'; then",
						'case " ${PROMPT_COMMAND[*]} " in *" __nexus_prompt_marker "*) ;; *) PROMPT_COMMAND+=(__nexus_prompt_marker) ;; esac;',
						'else',
						'case ";${PROMPT_COMMAND-};" in *";__nexus_prompt_marker;"*) ;; *) PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}__nexus_prompt_marker" ;; esac;',
						'fi',
					].join(' ')
				: 'autoload -Uz add-zsh-hook 2>/dev/null; ' +
					functionBody +
					' add-zsh-hook -d precmd __nexus_prompt_marker 2>/dev/null; add-zsh-hook precmd __nexus_prompt_marker;';
		this.hookTask = this.startSetup(
			'hook',
			start,
			end,
			[
				'stty -echo 2>/dev/null;',
				hook,
				"printf '\\n" + octal(start) + 'ok' + octal(end) + "\\n';",
				': ' + quote(historyToken) + ';',
				cleanHistory(this.kind, historyToken),
				'stty echo 2>/dev/null;',
			].join(' ') + '\r',
		).finally(() => {
			this.hookTask = null;
		});
		return this.hookTask;
	}

	private startSetup(kind: Setup['kind'], start: string, end: string, command: string): Promise<void> {
		if (this.setup) {
			throw new Error('Shell integration already initializing');
		}
		return new Promise<void>((resolve, reject) => {
			const setup: Setup = {
				kind,
				start: Buffer.from(start, 'ascii'),
				end: Buffer.from(end, 'ascii'),
				buffer: Buffer.alloc(0),
				capturing: false,
				timer: setTimeout(() => {
					if (this.setup === setup) {
						this.setup = null;
					}
					reject(new Error('Shell integration timed out'));
				}, SETUP_TIMEOUT_MS),
				resolve,
				reject,
			};
			setup.timer.unref();
			this.setup = setup;
			try {
				this.write(Buffer.from(command, 'utf8'));
			} catch (error) {
				this.finishSetup(setup);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private finishSetup(setup: Setup): void {
		clearTimeout(setup.timer);
		if (this.setup === setup) {
			this.setup = null;
		}
	}

	/** Called only on stdout, before replay journal and all WS output listeners. */
	filterOutput(chunk: Uint8Array): Uint8Array {
		if (this.closed) {
			return new Uint8Array();
		}
		let value = Buffer.from(chunk);
		const setup = this.setup;
		if (setup) {
			let joined = Buffer.concat([setup.buffer, value]);
			let visiblePrefix = Buffer.alloc(0);
			if (!setup.capturing) {
				const begin = joined.indexOf(setup.start);
				if (begin < 0) {
					// Never discard arbitrary terminal output while waiting for
					// a probe. Retain only a possible fragmented marker prefix.
					const held = partialSuffix(joined, setup.start);
					setup.buffer = Buffer.from(joined.subarray(joined.length - held));
					value = joined.subarray(0, joined.length - held);
				} else {
					visiblePrefix = joined.subarray(0, begin);
					joined = joined.subarray(begin);
					setup.capturing = true;
				}
			}
			if (setup.capturing) {
				const end = joined.indexOf(setup.end, setup.start.length);
				if (end < 0) {
					if (joined.length > MAX_SETUP_BYTES) {
						this.finishSetup(setup);
						setup.reject(new Error('Shell setup response too large'));
					} else {
						setup.buffer = Buffer.from(joined);
					}
					value = visiblePrefix;
				} else {
					const answer = joined.subarray(setup.start.length, end).toString('utf8').trim();
					this.finishSetup(setup);
					if (setup.kind === 'probe') {
						const match = /^(\d+):(bash|zsh|other)$/u.exec(answer);
						if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) {
							setup.reject(new Error('Interactive shell did not return its PID'));
						} else {
							this.pid = Number(match[1]);
							this.kind = match[2] as WorkspaceShellKind;
							setup.resolve();
						}
					} else if (answer === 'ok') {
						this.ready = true;
						setup.resolve();
					} else {
						setup.reject(new Error('Prompt integration setup failed'));
					}
					value = Buffer.concat([visiblePrefix, joined.subarray(end + setup.end.length)]);
				}
			}
		}
		const data = this.markerRemainder.length ? Buffer.concat([this.markerRemainder, value]) : value;
		this.markerRemainder = Buffer.alloc(0);
		let begin = data.indexOf(this.promptMarker);
		if (begin < 0) {
			const partial = partialSuffix(data, this.promptMarker);
			if (partial) {
				this.markerRemainder = Buffer.from(data.subarray(-partial));
			}
			return data.subarray(0, data.length - partial);
		}
		const visible: Buffer[] = [];
		let cursor = 0;
		while (begin >= 0) {
			if (this.suppressUntilPrompt) {
				// An internal cd echo is possible, but suppressing every byte
				// here also hides unrelated background job stdout. Preserve it.
				if (begin > cursor) {
					visible.push(data.subarray(cursor, begin));
				}
				visible.push(CLEAR_LINE);
				this.suppressUntilPrompt = false;
			} else if (begin > cursor) {
				visible.push(data.subarray(cursor, begin));
			}
			this.atPrompt = true;
			this.ready = true;
			this.options.onPrompt();
			cursor = begin + this.promptMarker.length;
			begin = data.indexOf(this.promptMarker, cursor);
		}
		const tail = data.subarray(cursor);
		const partial = partialSuffix(tail, this.promptMarker);
		if (partial) {
			this.markerRemainder = Buffer.from(tail.subarray(-partial));
		}
		if (tail.length > partial) {
			visible.push(tail.subarray(0, tail.length - partial));
		}
		return Buffer.concat(visible);
	}

	changeDirectory(directory: string): void {
		this.assertOpen();
		this.atPrompt = false;
		this.suppressUntilPrompt = true;
		const historyToken = marker('INTERNAL_CD');
		this.write(
			Buffer.from(
				'\x15cd ' +
					quote(directory) +
					'; : ' +
					quote(historyToken) +
					'; ' +
					cleanHistory(this.kind, historyToken) +
					'\r',
				'utf8',
			),
		);
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		if (this.setup) {
			const setup = this.setup;
			this.finishSetup(setup);
			setup.reject(new Error('Shell integration closed'));
		}
		this.markerRemainder = Buffer.alloc(0);
	}
}

export class NativeShellIntegrationFactory implements ShellIntegrationFactory {
	create(options: ShellIntegrationOptions): ShellIntegrationPort {
		return new NativeShellIntegration(options);
	}
}
