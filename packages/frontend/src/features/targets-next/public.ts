/** Explicit opt-in backend-next management; never shares legacy Pinia/Workspace state. */
export { createTargetsNextApi } from './api/targets-next-api';

export const loadTargetsNextDevView = () => import('./views/TargetsNextDevView.vue');

export type { TargetConnectionInput, TargetConnectionChanges, TargetCredentialInput, TargetImportInput } from '@nexus-terminal/shared/targets/connections/http';
export type { TargetConnectionView } from '@nexus-terminal/shared/targets/connections/model';

export type { TargetProxyInput, TargetProxyChanges } from '@nexus-terminal/shared/targets/proxies/http';
export type { TargetProxyView } from '@nexus-terminal/shared/targets/proxies/model';

export type { TargetTagView } from '@nexus-terminal/shared/targets/tags/model';

export type { TargetSshKeyView } from '@nexus-terminal/shared/targets/ssh-keys/model';
export type { TargetSshKeyInput, TargetSshKeyChanges } from '@nexus-terminal/shared/targets/ssh-keys/http';
