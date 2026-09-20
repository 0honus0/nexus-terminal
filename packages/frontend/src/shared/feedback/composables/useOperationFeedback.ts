import { logger } from '@/client/logging/logger';
import { useFeedback } from './useFeedback';

export interface OperationFailureOptions {
  operation: string;
  message: string;
  cause?: unknown;
  context?: Record<string, unknown>;
}

export const useOperationFeedback = (scope: string) => {
  const feedback = useFeedback();

  const notifySuccess = (message: string): void => {
    feedback.notifySuccess(message);
  };

  const logError = ({ operation, message, cause, context }: OperationFailureOptions): void => {
    logger.error(
      {
        scope,
        operation,
        ...(context ?? {}),
        ...(cause === undefined ? {} : { err: cause }),
      },
      message,
    );
  };

  const notifyError = (failure: OperationFailureOptions): void => {
    logError(failure);
    feedback.notifyError(failure.message, 0);
  };

  const notifyWarning = (message: string): void => {
    feedback.notifyWarning(message);
  };

  const notifyInfo = (message: string): void => {
    feedback.notifyInfo(message);
  };

  return {
    notifySuccess,
    notifyError,
    logError,
    notifyWarning,
    notifyInfo,
  };
};
