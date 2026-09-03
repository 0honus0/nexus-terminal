export interface UploadStartRequest {
  ownerId: string;
  sessionId: string;
  uploadId: string;
  destinationPath: string;
  size: number;
}

export interface UploadOperation {
  start(request: UploadStartRequest): Promise<void>;
  append(uploadId: string, chunk: Uint8Array): Promise<void>;
  cancel(ownerId: string, uploadId: string): Promise<boolean>;
  cancelOwner(ownerId: string): Promise<void>;
}
