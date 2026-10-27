import { TERMINAL_THEME_LIST_MAX_ITEMS } from '@nexus-terminal/shared/preferences/themes/values';
import { ThemeFailure } from '../../theme-failure.js';
import type { ThemeModel } from '../model/theme-model.js';
import type { ThemeActor, ThemeRecord, ThemeInput, ThemeChange, ThemeVersion } from '../model/theme-types.js';
import { validateThemeInput, admitThemeMutation, planThemePreset } from '../theme-rules.js';
import { terminalThemePresets } from './theme-presets.js';

export class ThemeService {
	private accepting = true;
	private readonly imports = new Set<AbortController>();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly failures: unknown[] = [];
	private droppedFailures = 0;
	private closePromise: Promise<void> | null = null;

	constructor(private readonly model: ThemeModel) {}

	async initialize(): Promise<void> {
		const keys = new Set(terminalThemePresets.map((value) => value.key));
		const names = new Set(terminalThemePresets.map((value) => value.name));
		if (
			keys.size !== terminalThemePresets.length ||
			names.size !== terminalThemePresets.length ||
			terminalThemePresets.length > TERMINAL_THEME_LIST_MAX_ITEMS
		) {
			throw new ThemeFailure('internal_failure');
		}
		for (const preset of terminalThemePresets) {
			validateThemeInput({ name: preset.name, colors: preset.colors });
		}
		await this.model.seed(terminalThemePresets, (preset, facts) => planThemePreset(preset, facts, names));
	}

	private run<T>(actor: ThemeActor, work: () => Promise<T>): Promise<T> {
		if (!this.accepting || this.pending.size >= 16) {
			return Promise.reject(new ThemeFailure('unavailable'));
		}
		if (!Number.isSafeInteger(actor.userId) || actor.userId < 1 || !actor.token) {
			return Promise.reject(new ThemeFailure('unauthenticated'));
		}
		const task = Promise.resolve().then(() => {
			if (!this.accepting) {
				throw new ThemeFailure('unavailable');
			}
			return work();
		});
		this.pending.add(task);
		void task
			.catch((error) => {
				if (
					!(error instanceof ThemeFailure) ||
					['storage_unavailable', 'operation_unknown', 'internal_failure'].includes(error.code)
				) {
					if (this.failures.length < 32) {
						this.failures.push(error);
					} else {
						this.droppedFailures++;
					}
				}
			})
			.finally(() => this.pending.delete(task));
		return task;
	}

	list(actor: ThemeActor): Promise<ThemeRecord[]> {
		return this.run(actor, async () => {
			const rows = await this.model.list(actor.userId);
			if (rows.length > TERMINAL_THEME_LIST_MAX_ITEMS) {
				throw new ThemeFailure('limit_exceeded');
			}
			return rows;
		});
	}

	get(actor: ThemeActor, id: number): Promise<ThemeRecord> {
		return this.run(actor, async () => {
			this.validateId(id);
			const row = await this.model.get(actor.userId, id);
			if (!row) {
				throw new ThemeFailure('not_found');
			}
			return row;
		});
	}

	create(actor: ThemeActor, input: ThemeInput): Promise<ThemeRecord> {
		return this.run(actor, () => this.save(actor, null, input));
	}

	update(actor: ThemeActor, change: ThemeChange): Promise<ThemeRecord> {
		return this.run(actor, () =>
			this.save(actor, { id: change.id, expectedVersion: change.expectedVersion }, change.input),
		);
	}

	import(actor: ThemeActor, loadInput: (signal: AbortSignal) => Promise<ThemeInput>): Promise<ThemeRecord> {
		return this.run(actor, async () => {
			const controller = new AbortController();
			this.imports.add(controller);
			try {
				return await this.save(actor, null, await loadInput(controller.signal));
			} finally {
				this.imports.delete(controller);
			}
		});
	}

	private async save(actor: ThemeActor, version: ThemeVersion | null, input: ThemeInput): Promise<ThemeRecord> {
		if (version) {
			this.validateVersion(version);
		}
		const normalized: ThemeInput = { name: input.name.trim(), colors: input.colors };
		validateThemeInput(normalized);
		const saved = await this.model.write(
			actor,
			version === null ? 'create' : 'update',
			version,
			normalized,
			(userId, facts) => {
				this.admitIdentity(actor, userId);
				admitThemeMutation(facts, version);
			},
		);
		if (saved === null) {
			throw new ThemeFailure('operation_unknown');
		}
		return saved;
	}

	delete(actor: ThemeActor, version: ThemeVersion): Promise<void> {
		return this.run(actor, async () => {
			this.validateVersion(version);
			await this.model.write(actor, 'delete', version, null, (userId, facts) => {
				this.admitIdentity(actor, userId);
				admitThemeMutation(facts, version);
			});
		});
	}

	private admitIdentity(actor: ThemeActor, userId: number | null): void {
		if (userId === null) {
			throw new ThemeFailure('unauthenticated');
		}
		if (userId !== actor.userId) {
			throw new ThemeFailure('forbidden');
		}
		if (!this.accepting) {
			throw new ThemeFailure('unavailable');
		}
	}

	private validateId(id: number): void {
		if (!Number.isSafeInteger(id) || id < 1) {
			throw new ThemeFailure('invalid_input');
		}
	}

	private validateVersion(value: ThemeVersion): void {
		this.validateId(value.id);
		if (
			!Number.isSafeInteger(value.expectedVersion) ||
			value.expectedVersion < 1 ||
			value.expectedVersion >= Number.MAX_SAFE_INTEGER
		) {
			throw new ThemeFailure('invalid_input');
		}
	}

	quiesce(): void {
		this.accepting = false;
		for (const controller of this.imports) {
			controller.abort();
		}
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.quiesce();
			this.closePromise = Promise.resolve().then(async () => {
				await Promise.allSettled([...this.pending]);
				if (this.failures.length || this.droppedFailures) {
					throw new AggregateError(
						this.failures,
						'Theme shutdown failures; additional=' + this.droppedFailures,
					);
				}
			});
		}
		return this.closePromise;
	}
}
