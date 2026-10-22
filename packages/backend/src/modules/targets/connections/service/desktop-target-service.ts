import type { DesktopTargetModel } from '../model/desktop-target-model.js';
import { TargetFailure } from '../../target-failure.js';
import { validateTargetId } from '../../target-validation.js';
import type { ResolvedDesktopTarget } from '../model/desktop-target-types.js';

export class DesktopTargetService {
	constructor(private readonly model: DesktopTargetModel) {}

	async get(id: number): Promise<ResolvedDesktopTarget | null> {
		validateTargetId(id);
		return this.model.get(id, (snapshot) => {
			if (snapshot.route !== 'direct') {
				throw new TargetFailure('unresolvable');
			}
		});
	}
}
