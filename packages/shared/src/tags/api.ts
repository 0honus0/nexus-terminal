import type { TargetTagView } from './model.js';

export type TargetTagMutation =
	{ status: 'updated'; value: TargetTagView } | { status: 'not_found' } | { status: 'version_conflict' };
