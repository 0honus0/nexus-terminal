import type { DesktopTargetModel } from '../model/desktop-target-model.js';
import { TargetFailure } from '../../target-failure.js';
import { validateTargetId } from '../../target-validation.js';
import type { ResolvedDesktopTarget } from '../model/desktop-target-types.js';

export class DesktopTargetService {
	constructor(private readonly model: DesktopTargetModel) {}

	async get(id: number): Promise<ResolvedDesktopTarget | null> {
		validateTargetId(id);
		const item = await this.model.get(id);
		if (!item) {
			return null;
		}
		if (item.route !== 'direct') {
			throw new TargetFailure('unresolvable');
		}
		return this.model.resolve(item);
	}

	markAttempt(id: number, version: number, timestamp: number): Promise<boolean> {
		validateTargetId(id);
		validateTargetId(version);
		return this.model.markAttempt(id, version, timestamp);
	}
}
