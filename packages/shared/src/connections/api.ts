import type { TargetConnectionView } from './model.js';
import type { TargetErrorCode } from '../targets/api.js';

export type TargetConnectionMutation =
	{ status: 'updated'; value: TargetConnectionView } | { status: 'not_found' } | { status: 'version_conflict' };

export type TargetCredentialMutation = { status: 'updated' } | { status: 'not_found' } | { status: 'version_conflict' };

export type TargetImportItem = { status: 'ok'; id: number } | { status: 'error'; code: TargetErrorCode };
