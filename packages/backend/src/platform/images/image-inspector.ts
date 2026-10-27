export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'svg';

export interface ImageFacts {
	format: ImageFormat | null;
	sizeBytes: number;
	sha256: string;
}

export interface ImageInspector {
	inspect(bytes: Uint8Array): Promise<ImageFacts>;
}
