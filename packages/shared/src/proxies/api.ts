import type { TargetProxyView } from './model.js';

export type TargetProxyMutation =
	{ status: 'updated'; value: TargetProxyView } | { status: 'not_found' } | { status: 'version_conflict' };
