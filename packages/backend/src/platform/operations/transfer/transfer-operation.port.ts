export interface TransferSourceItem {
  path: string;
  size: number;
  isDirectory: boolean;
}

export interface TransferRequest {
  requestId: string;
  sourceSessionId: string;
  destinationSessionId: string;
  sourceItems: readonly TransferSourceItem[];
  destinationPath: string;
}

export type TransferEvent =
  | { type: 'progress'; requestId: string; progress: number; transferredBytes: number }
  | { type: 'completed'; requestId: string }
  | { type: 'failed'; requestId: string; message: string }
  | { type: 'cancelled'; requestId: string };

export interface TransferOperation {
  run(request: TransferRequest, emit: (event: TransferEvent) => void): Promise<void>;
  cancel(requestId: string): Promise<boolean>;
}
