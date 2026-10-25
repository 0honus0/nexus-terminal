import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { ArtifactActor } from '../../artifacts/model/artifact-types.js';
import type { ProviderService } from './provider-service.js';
import type { ProviderImageRequest, ImageArtifact } from '../model/provider-types.js';

/** Both direct image Runs and governed tool calls use the same generation and file ownership. */
export class ProviderImageService {
	constructor(
		private readonly providers: ProviderService,
		private readonly artifacts: ArtifactService,
	) {}

	async generate(
		actor: Exclude<ArtifactActor, { kind: 'session' }>,
		input: ProviderImageRequest,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<ImageArtifact> {
		await validate();
		const result = await this.providers.generateImage(actor.userId, input, signal, validate);
		await validate();
		const extension =
			result.mediaType === 'image/jpeg' ? 'jpg' : result.mediaType === 'image/webp' ? 'webp' : 'png';
		const value = await this.artifacts.begin(actor, {
			name: 'generated-image.' + extension,
			mediaType: result.mediaType,
			declaredBytes: result.bytes.byteLength,
		});

		async function* source(): AsyncIterable<Uint8Array> {
			yield result.bytes;
		}

		const saved = await this.artifacts.upload(actor, value.id, value.version, source(), signal);
		await validate();
		const root =
			'/api/v1/agent/apps/' + encodeURIComponent(actor.appId) + '/artifacts/' + encodeURIComponent(saved.id);
		return {
			id: saved.id,
			name: saved.name,
			previewUrl: root + '/preview',
			downloadUrl: root + '/content',
			sizeBytes: saved.sizeBytes,
		};
	}
}
