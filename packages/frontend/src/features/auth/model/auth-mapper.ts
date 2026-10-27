import type { AccessUserView } from '@nexus-terminal/shared/access/model';
import type { AuthUser } from './auth-types';

export function toAuthUser(value: AccessUserView): AuthUser {
	return { id: value.id, username: value.username, twoFactorEnabled: value.twoFactorEnabled };
}
