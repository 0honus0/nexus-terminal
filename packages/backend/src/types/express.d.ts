import 'express-session';

declare module 'express-session' {
    interface SessionData {
        userId?: number;
        username?: string;
        tempTwoFactorSecret?: string;
        requiresTwoFactor?: boolean;
        currentChallenge?: string;
        passkeyUserHandle?: string;
        passkeyOrigin?: string;
        rememberMe?: boolean;
    }
}

declare global {
    namespace Express {
        interface Request {
            fileValidationError?: string;
        }
    }
}

export {};
