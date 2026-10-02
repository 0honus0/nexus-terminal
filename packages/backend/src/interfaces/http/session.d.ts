import 'express-session';

declare module 'express-session' {
  interface SessionData {
    credentialRevision?: string;
    userId?: number;
    username?: string;
    requiresTwoFactor?: boolean;
    rememberMe?: boolean;
    tempTwoFactorSecret?: string;
    currentChallenge?: string;
    passkeyOrigin?: string;
    passkeyRegistrationUserId?: number;
  }
}
