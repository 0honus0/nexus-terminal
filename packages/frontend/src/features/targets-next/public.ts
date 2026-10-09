/** Explicit opt-in backend-next management; never shares legacy Pinia/Workspace state. */
export { createTargetsNextApi } from './api/targets-next-api';

export const loadTargetsNextDevView = () => import('./views/TargetsNextDevView.vue');

export type {
	TargetConnectionInput,
	TargetConnectionView,
	TargetConnectionChanges,
	TargetCredentialInput,
	TargetImportInput,
} from '@nexus-terminal/shared/connections/model';

export type { TargetProxyInput, TargetProxyView, TargetProxyChanges } from '@nexus-terminal/shared/proxies/model';

export type { TargetTagView } from '@nexus-terminal/shared/tags/model';

export type { TargetSshKeyView, TargetSshKeyInput, TargetSshKeyChanges } from '@nexus-terminal/shared/ssh-keys/model';
