import type { AgentErrorRule } from './rule';
import { onCodes, rawCode } from './rule';

export const artifactErrorRules: readonly AgentErrorRule[] = [
  onCodes(['PAYLOAD_TOO_LARGE'], {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Artifact payload is too large.',
  }),
  onCodes(['ARTIFACT_QUOTA_EXCEEDED'], {
    status: 507,
    code: 'ARTIFACT_QUOTA_EXCEEDED',
    message: 'Artifact storage quota is exhausted.',
  }),
  onCodes(['ARTIFACT_RANGE_INVALID'], {
    status: 416,
    code: 'ARTIFACT_RANGE_INVALID',
    message: 'Artifact range is not satisfiable.',
  }),
  onCodes(['ARTIFACT_UNAVAILABLE'], {
    status: 410,
    code: 'ARTIFACT_UNAVAILABLE',
    message: 'Artifact payload is unavailable.',
  }),
  onCodes(['ARTIFACT_UPLOAD_BUSY'], {
    status: 429,
    code: 'ARTIFACT_UPLOAD_BUSY',
    message: 'Too many artifact uploads are active.',
  }),
  onCodes(
    ['ARTIFACT_UPLOAD_EXPIRED', 'ARTIFACT_SIZE_MISMATCH'],
    rawCode(409, 'Artifact upload state is no longer valid.'),
  ),
  onCodes(['ARTIFACT_PROTECTED'], rawCode(409, 'Artifact is retained or protected by an active reference.')),
  onCodes(['CLEANUP_CONFIRMATION_NOT_FOUND'], rawCode(404, 'Artifact cleanup confirmation was not found.')),
  onCodes(['CLEANUP_CONFIRMATION_EXPIRED'], rawCode(409, 'Artifact cleanup confirmation expired; preview again.')),
  onCodes(
    ['ARTIFACT_CROSS_APP_ATTACH_REQUIRED'],
    rawCode(409, 'Cross-App Artifact use requires an explicit Host attach.'),
  ),
];
