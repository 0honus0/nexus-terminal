/** Access identity visible to an authenticated client; never contains credentials or token. */
export interface AccessUserView {
	id: number;
	username: string;
	twoFactorEnabled: boolean;
}
