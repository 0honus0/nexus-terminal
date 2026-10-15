import type { AppearanceService } from './appearance-service.js';
import type { HtmlThemeSource, HtmlThemeSourceChange, RemoteHtmlThemeListing } from '../model/html-theme-types.js';
import { AppearanceFailure } from '../../appearance-failure.js';
import { parseHtmlThemeRepository, validateRawHtmlThemeUrl, projectRemoteHtmlThemes } from '../html-theme-rules.js';
import { HTML_THEME_LIST_MAX_ITEMS } from '@nexus-terminal/shared/preferences/html-themes/values';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { HtmlThemeFailure, HtmlThemeResourceFailure } from '../../html-theme-failure.js';
import type { HtmlThemeModel } from '../model/html-theme-model.js';
import type {
	HtmlThemeActor,
	HtmlThemeRecord,
	HtmlThemeListing,
	HtmlThemeInput,
	HtmlThemeChange,
	HtmlThemeVersion,
} from '../model/html-theme-types.js';
import { validateHtmlThemeName, validateHtmlThemeInput, admitHtmlThemeMutation } from '../html-theme-rules.js';
import { htmlThemePresets } from './html-theme-presets.js';

export class HtmlThemeService {
	private accepting = true;
	private readonly pending = new Set<Promise<unknown>>();
	private readonly controllers = new Set<AbortController>();
	private readonly failures = new FailureSummary();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly model: HtmlThemeModel,
		private readonly appearance: AppearanceService,
	) {
		const names = new Set<string>();
		for (const preset of htmlThemePresets) {
			validateHtmlThemeInput(preset);
			if (names.has(preset.name)) {
				throw new HtmlThemeFailure('internal_failure');
			}
			names.add(preset.name);
		}
	}

	private run<T>(actor: HtmlThemeActor, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (!this.accepting || this.pending.size >= 16) {
			return Promise.reject(new HtmlThemeFailure('unavailable'));
		}
		if (!Number.isSafeInteger(actor.userId) || actor.userId < 1 || !actor.token) {
			return Promise.reject(new HtmlThemeFailure('unauthenticated'));
		}
		const controller = new AbortController();
		this.controllers.add(controller);
		const task = Promise.resolve().then(() => {
			this.ready(controller.signal);
			return work(controller.signal);
		});
		this.pending.add(task);
		void task
			.catch((error) => {
				if (
					!(error instanceof HtmlThemeFailure) ||
					['storage_unavailable', 'operation_unknown', 'internal_failure', 'cleanup_failed'].includes(
						error.code,
					)
				) {
					this.failures.record(error);
					if (error instanceof HtmlThemeResourceFailure) {
						this.quiesce();
					}
				}
			})
			.finally(() => {
				this.pending.delete(task);
				this.controllers.delete(controller);
			});
		return task;
	}

	private ready(signal: AbortSignal): void {
		if (!this.accepting || signal.aborted) {
			throw new HtmlThemeFailure('unavailable');
		}
	}

	private admit(actor: HtmlThemeActor, userId: number | null, signal: AbortSignal): void {
		if (userId === null) {
			throw new HtmlThemeFailure('unauthenticated');
		}
		if (userId !== actor.userId) {
			throw new HtmlThemeFailure('forbidden');
		}
		this.ready(signal);
	}

	list(actor: HtmlThemeActor): Promise<HtmlThemeListing[]> {
		return this.run(actor, async (signal) => {
			const custom = await this.model.list(actor.userId);
			this.ready(signal);
			const presets = htmlThemePresets.map((row) => ({
				name: row.name,
				kind: row.kind,
				version: row.version,
				updatedAt: row.updatedAt,
			}));
			if (presets.length + custom.length > HTML_THEME_LIST_MAX_ITEMS) {
				throw new HtmlThemeFailure('limit_exceeded');
			}
			return presets.concat(custom);
		});
	}

	readLocal(
		actor: HtmlThemeActor,
		name: string,
		deliver: (content: string, signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		return this.run(actor, async (signal) => {
			validateHtmlThemeName(name);
			const custom = await this.model.get(actor.userId, name);
			this.ready(signal);
			if (custom !== null) {
				return deliver(custom.content, signal);
			}
			const preset = htmlThemePresets.find((row) => row.name === name);
			if (!preset) {
				throw new HtmlThemeFailure('not_found');
			}
			return deliver(preset.content, signal);
		});
	}

	create(
		actor: HtmlThemeActor,
		loadInput: (signal: AbortSignal) => Promise<HtmlThemeInput>,
	): Promise<HtmlThemeRecord> {
		return this.run(actor, async (signal) => {
			const input = await loadInput(signal);
			validateHtmlThemeInput(input);
			const row = await this.model.write(
				actor,
				'create',
				input.name,
				{ name: input.name, content: input.content },
				(userId, facts) => {
					this.admit(actor, userId, signal);
					admitHtmlThemeMutation(facts, null);
				},
			);
			if (row === null) {
				throw new HtmlThemeFailure('operation_unknown');
			}
			return row;
		});
	}

	update(
		actor: HtmlThemeActor,
		loadInput: (signal: AbortSignal) => Promise<HtmlThemeChange>,
	): Promise<HtmlThemeRecord> {
		return this.run(actor, async (signal) => {
			const change = await loadInput(signal);
			validateHtmlThemeInput({ name: change.name, content: change.content });
			const row = await this.model.write(
				actor,
				'update',
				change.name,
				{ name: change.name, content: change.content },
				(userId, facts) => {
					this.admit(actor, userId, signal);
					admitHtmlThemeMutation(facts, change.expectedVersion);
				},
			);
			if (row === null) {
				throw new HtmlThemeFailure('operation_unknown');
			}
			return row;
		});
	}

	delete(actor: HtmlThemeActor, loadInput: (signal: AbortSignal) => Promise<HtmlThemeVersion>): Promise<void> {
		return this.run(actor, async (signal) => {
			const version = await loadInput(signal);
			validateHtmlThemeName(version.name);
			await this.model.write(actor, 'delete', version.name, null, (userId, facts) => {
				this.admit(actor, userId, signal);
				admitHtmlThemeMutation(facts, version.expectedVersion);
			});
		});
	}

	private async source(actor: HtmlThemeActor): Promise<HtmlThemeSource> {
		try {
			const result = await this.appearance.get({ userId: actor.userId, token: actor.token });
			return { url: result.value.remoteHtmlPresetsUrl, version: result.value.version, changed: result.changed };
		} catch (cause) {
			if (cause instanceof AppearanceFailure) {
				throw new HtmlThemeFailure(cause.code === 'theme_not_found' ? 'not_found' : cause.code, { cause });
			}
			throw new HtmlThemeFailure('internal_failure', { cause });
		}
	}

	getSource(actor: HtmlThemeActor): Promise<HtmlThemeSource> {
		return this.run(actor, () => this.source(actor));
	}

	setSource(
		actor: HtmlThemeActor,
		loadInput: (signal: AbortSignal) => Promise<HtmlThemeSourceChange>,
	): Promise<HtmlThemeSource> {
		return this.run(actor, async (signal) => {
			const input = await loadInput(signal);
			if (input.url !== null) {
				parseHtmlThemeRepository(input.url);
			}
			try {
				const result = await this.appearance.update({ userId: actor.userId, token: actor.token }, async () => {
					this.ready(signal);
					return { expectedVersion: input.expectedVersion, patch: { remoteHtmlPresetsUrl: input.url } };
				});
				return { url: result.remoteHtmlPresetsUrl, version: result.version, changed: true };
			} catch (cause) {
				if (cause instanceof AppearanceFailure) {
					throw new HtmlThemeFailure(cause.code === 'theme_not_found' ? 'not_found' : cause.code, { cause });
				}
				throw new HtmlThemeFailure('internal_failure', { cause });
			}
		});
	}

	listRemote(
		actor: HtmlThemeActor,
		source: string | null,
		requestSignal: AbortSignal,
	): Promise<RemoteHtmlThemeListing[]> {
		return this.run(actor, async (ownerSignal) => {
			const signal = AbortSignal.any([ownerSignal, requestSignal, AbortSignal.timeout(10000)]);
			const saved = source === null ? await this.source(actor) : null;
			const url = source ?? saved?.url;
			if (!url) {
				throw new HtmlThemeFailure('source_invalid');
			}
			const entries = await this.model.listRemote(parseHtmlThemeRepository(url), signal);
			const rows = projectRemoteHtmlThemes(entries);
			this.ready(signal);
			if (saved !== null) {
				const current = await this.source(actor);
				if (current.version !== saved.version || current.url !== saved.url) {
					throw new HtmlThemeFailure('source_changed');
				}
			}
			this.ready(signal);
			return rows;
		});
	}

	readRemote(
		actor: HtmlThemeActor,
		url: string,
		requestSignal: AbortSignal,
		deliver: (content: string, signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		return this.run(actor, async (ownerSignal) => {
			validateRawHtmlThemeUrl(url);
			const signal = AbortSignal.any([ownerSignal, requestSignal, AbortSignal.timeout(10000)]);
			const content = await this.model.readRemote(url, signal);
			this.ready(signal);
			validateHtmlThemeInput({ name: 'remote.html', content });
			return deliver(content, signal);
		});
	}

	quiesce(): void {
		this.accepting = false;
		for (const controller of this.controllers) {
			controller.abort();
		}
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.quiesce();
			this.closePromise = Promise.resolve().then(async () => {
				await Promise.allSettled([...this.pending]);
				const errors = this.failures.errors();
				if (errors.length) {
					throw new AggregateError(errors, 'HTML theme shutdown failed');
				}
			});
		}
		return this.closePromise;
	}
}
