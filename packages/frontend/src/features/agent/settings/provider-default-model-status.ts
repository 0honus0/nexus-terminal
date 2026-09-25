export type ProviderDefaultModelStatus =
  { kind: 'none'; modelId: null } | { kind: 'default'; modelId: string } | { kind: 'stale'; modelId: string };

export const resolveProviderDefaultModelStatus = (input: {
  providerId: string;
  modelIds: readonly string[];
  defaultProviderId: string | null;
  defaultModelId: string | null;
}): ProviderDefaultModelStatus => {
  if (input.providerId !== input.defaultProviderId || !input.defaultModelId) return { kind: 'none', modelId: null };
  return input.modelIds.includes(input.defaultModelId)
    ? { kind: 'default', modelId: input.defaultModelId }
    : { kind: 'stale', modelId: input.defaultModelId };
};
