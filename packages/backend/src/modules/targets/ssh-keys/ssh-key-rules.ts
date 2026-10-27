import { TARGET_SSH_KEY_NAME_MAX_BYTES } from '@nexus-terminal/shared/targets/ssh-keys/values';
import { validateTargetText } from '../target-validation.js';

export function validateSshKeyName(value: string): string {
	return validateTargetText(value, TARGET_SSH_KEY_NAME_MAX_BYTES, false).trim();
}
