export interface AgentErrorMapping {
  status: number;
  code: string;
  message: string;
}

export interface AgentErrorRule {
  matches(raw: string): boolean;
  mapping(raw: string): AgentErrorMapping;
}

type MappingFactory = AgentErrorMapping | ((raw: string) => AgentErrorMapping);

const mappingFor = (mapping: MappingFactory, raw: string): AgentErrorMapping =>
  typeof mapping === 'function' ? mapping(raw) : mapping;

export const onCodes = (codes: readonly string[], mapping: MappingFactory): AgentErrorRule => ({
  matches: (raw) => codes.includes(raw),
  mapping: (raw) => mappingFor(mapping, raw),
});

export const onPrefixes = (prefixes: readonly string[], mapping: MappingFactory): AgentErrorRule => ({
  matches: (raw) => prefixes.some((prefix) => raw.startsWith(prefix)),
  mapping: (raw) => mappingFor(mapping, raw),
});

export const onCodesOrPrefixes = (
  codes: readonly string[],
  prefixes: readonly string[],
  mapping: MappingFactory,
): AgentErrorRule => ({
  matches: (raw) => codes.includes(raw) || prefixes.some((prefix) => raw.startsWith(prefix)),
  mapping: (raw) => mappingFor(mapping, raw),
});

export const rawCode =
  (status: number, message: string) =>
  (raw: string): AgentErrorMapping => ({
    status,
    code: raw,
    message,
  });
