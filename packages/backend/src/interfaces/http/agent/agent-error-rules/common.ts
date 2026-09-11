import type { AgentErrorRule } from './rule';
import { onCodes, onCodesOrPrefixes, rawCode } from './rule';

export const commonErrorRules: readonly AgentErrorRule[] = [
  onCodes(['VALIDATION_FAILED'], {
    status: 400,
    code: 'VALIDATION_FAILED',
    message: 'Invalid Agent request.',
  }),
  onCodesOrPrefixes(['AGENT_APP_NOT_FOUND'], ['Agent App not registered:'], {
    status: 404,
    code: 'NOT_FOUND',
    message: 'Agent resource was not found.',
  }),
  onCodes(['SETTINGS_VERSION_CONFLICT'], rawCode(409, 'Agent settings changed; refresh and retry.')),
  onCodes(['APP_STATE_VERSION_CONFLICT', 'APP_POLICY_VERSION_CONFLICT'], {
    status: 409,
    code: 'STATE_CONFLICT',
    message: 'Agent resource changed; refresh and retry.',
  }),
  onCodes(
    ['APP_CAPABILITY_UNDECLARED'],
    rawCode(422, 'The Agent App does not declare one or more requested capabilities.'),
  ),
  onCodes(['APP_CAPABILITY_DENIED'], rawCode(403, 'The Agent App capability is not granted.')),
  onCodes(['HARD_LIMIT_CONFIRMATION_NOT_FOUND'], rawCode(404, 'Hard Limit confirmation was not found.')),
  onCodes(['HARD_LIMIT_CONFIRMATION_EXPIRED'], rawCode(409, 'Hard Limit confirmation expired; preview again.')),
  onCodes(
    ['HARD_LIMIT_BELOW_USAGE'],
    rawCode(409, 'Hard Limit cannot be lowered below current reserved or used resources.'),
  ),
  onCodes(['HARD_LIMIT_RELATION_INVALID', 'HARD_LIMIT_NO_CHANGES'], rawCode(400, 'Invalid Hard Limit change.')),
  onCodes(['STATE_CONFLICT', 'TARGET_DENYLIST_VERSION_CONFLICT'], {
    status: 409,
    code: 'STATE_CONFLICT',
    message: 'Agent resource changed; refresh and retry.',
  }),
  onCodes(['TARGET_CONNECTION_NOT_FOUND'], {
    status: 404,
    code: 'NOT_FOUND',
    message: 'One or more target connections were not found.',
  }),
  onCodes(['NOT_FOUND'], {
    status: 404,
    code: 'NOT_FOUND',
    message: 'Agent resource was not found.',
  }),
  onCodes(['CURSOR_INVALID'], { status: 400, code: 'CURSOR_INVALID', message: 'Invalid cursor.' }),
  onCodes(['CURSOR_CONFLICT'], { status: 400, code: 'CURSOR_CONFLICT', message: 'Cursor sources disagree.' }),
  onCodes(['CURSOR_AHEAD'], {
    status: 400,
    code: 'CURSOR_AHEAD',
    message: 'Cursor is ahead of the durable stream.',
  }),
  onCodes(['CAPABILITY_UNAVAILABLE'], rawCode(409, 'This Agent capability is not enabled in the current phase.')),
  onCodes(['AGENT_DEFINITION_NOT_FOUND'], {
    status: 404,
    code: 'NOT_FOUND',
    message: 'Agent definition was not found.',
  }),
  onCodes(['HARD_LIMIT_CONFIRMATION_REQUIRED'], {
    status: 409,
    code: 'HARD_LIMIT_CONFIRMATION_REQUIRED',
    message: 'Hard Limits require the dedicated confirmation flow.',
  }),
];
