import type { TargetSshKeyView } from './model.js';

export type TargetSshKeyMutation =
	{ status: 'updated'; value: TargetSshKeyView } | { status: 'not_found' } | { status: 'version_conflict' };
