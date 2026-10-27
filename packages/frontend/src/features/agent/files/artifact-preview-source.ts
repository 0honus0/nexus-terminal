import { toRaw } from 'vue';
import type { FilePreviewReadOptions, FilePreviewReadResult, FilePreviewSource } from '@/features/file-preview/public';
import { downloadManagedArtifact } from '../api/artifact-management-api';
import type { ManagedArtifact } from '../model/artifact-types';

/** Projects one ready Artifact onto the shared inline-preview source contract. */
export function createArtifactPreviewSource(item: ManagedArtifact, failureMessage: string): FilePreviewSource {
	const snapshot = structuredClone(toRaw(item));

	return {
		async read(_path: string, options?: FilePreviewReadOptions): Promise<FilePreviewReadResult> {
			const maxBytes = options?.maxBytes;
			if (maxBytes !== undefined && snapshot.sizeBytes > maxBytes) {
				return { tooLarge: true, actualBytes: snapshot.sizeBytes, maxBytes };
			}
			try {
				const blob = await downloadManagedArtifact(snapshot, options?.signal);
				return { bytes: await blob.arrayBuffer(), mimeType: snapshot.mediaType };
			} catch (cause) {
				// 关闭预览会中止请求；按取消上报，避免在会话里留下失败标签。
				if (options?.signal?.aborted) throw new DOMException('Preview request aborted', 'AbortError');
				throw new Error(failureMessage, { cause });
			}
		},
	};
}
