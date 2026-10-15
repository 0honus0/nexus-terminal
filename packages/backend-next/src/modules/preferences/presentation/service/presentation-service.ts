import { drainPreferences } from '../../preferences-lifecycle.js';
import type { PresentationModel } from '../model/presentation-model.js';
import type {
	PresentationActor,
	PresentationIdentity,
	PresentationView,
	PresentationChange,
	PresentationData,
} from '../model/presentation-types.js';
import { defaultPresentation } from '../presentation-defaults.js';
import { validatePresentation } from '../presentation-rules.js';
import { PresentationFailure } from '../../presentation-failure.js';

function admit(actor: PresentationActor, identity: PresentationIdentity): void {
	if (identity.userId === null) {
		throw new PresentationFailure('unauthenticated');
	}
	if (identity.userId !== actor.userId) {
		throw new PresentationFailure('forbidden');
	}
}

function change(current: PresentationData, command: PresentationChange): PresentationData {
	return {
		preferences: command.action === 'preferences' ? command.preferences : current.preferences,
		layout: command.action === 'layout' || command.action === 'workspace' ? command.layout : current.layout,
		focus: command.action === 'focus' ? command.focus : current.focus,
		sidebar: command.action === 'sidebar' || command.action === 'workspace' ? command.sidebar : current.sidebar,
	};
}

export class PresentationService {
	private accepting = true;
	private readonly pending = new Set<Promise<unknown>>();
	private closePromise: Promise<void> | null = null;

	constructor(private readonly model: PresentationModel) {}

	private run<T>(actor: PresentationActor, work: () => Promise<T>): Promise<T> {
		if (!this.accepting || this.pending.size >= 16) {
			return Promise.reject(new PresentationFailure('unavailable'));
		}
		if (!Number.isSafeInteger(actor.userId) || actor.userId < 1 || !actor.token) {
			return Promise.reject(new PresentationFailure('unauthenticated'));
		}
		const task = Promise.resolve().then(work);
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => undefined);
		return task;
	}

	private async current(userId: number): Promise<PresentationView> {
		const value = await this.model.get(userId);
		if (value === null) {
			const initial = defaultPresentation();
			validatePresentation(initial.value);
			return initial;
		}
		try {
			validatePresentation(value.value);
		} catch (cause) {
			throw new PresentationFailure('storage_unavailable', { cause });
		}
		return value;
	}

	get(actor: PresentationActor): Promise<PresentationView> {
		return this.run(actor, () => this.current(actor.userId));
	}

	update(actor: PresentationActor, command: PresentationChange): Promise<PresentationView> {
		return this.run(actor, async () => {
			if (
				!Number.isSafeInteger(command.expectedVersion) ||
				command.expectedVersion < 0 ||
				command.expectedVersion >= Number.MAX_SAFE_INTEGER
			) {
				throw new PresentationFailure('invalid_input');
			}
			const current = await this.current(actor.userId);
			if (current.version !== command.expectedVersion) {
				throw new PresentationFailure('version_conflict');
			}
			const value = change(current.value, command);
			validatePresentation(value);
			const saved = await this.model.update(actor, command.expectedVersion, value, (identity) =>
				admit(actor, identity),
			);
			if (!saved) {
				throw new PresentationFailure('version_conflict');
			}
			return saved;
		});
	}

	quiesce(): void {
		this.accepting = false;
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.quiesce();
			this.closePromise = drainPreferences([...this.pending]);
		}
		return this.closePromise;
	}
}
