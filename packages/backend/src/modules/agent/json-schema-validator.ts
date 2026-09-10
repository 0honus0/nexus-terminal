import Ajv, { type ValidateFunction } from 'ajv';
import type { JsonValue } from './agent.types';

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  allowUnionTypes: false,
});

const compiled = new WeakMap<object, ValidateFunction>();

const schemaObject = (schema: JsonValue): Record<string, unknown> => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('JSON_SCHEMA_INVALID');
  return schema as Record<string, unknown>;
};

const validatorFor = (schema: JsonValue): ValidateFunction => {
  const object = schemaObject(schema);
  const cached = compiled.get(object);
  if (cached) return cached;
  let validator: ValidateFunction;
  try {
    validator = ajv.compile(object);
  } catch {
    throw new Error('JSON_SCHEMA_INVALID');
  }
  compiled.set(object, validator);
  return validator;
};

export const prepareJsonSchema = (schema: JsonValue): void => {
  void validatorFor(schema);
};

export const assertJsonSchema = (schema: JsonValue, value: unknown, errorCode = 'VALIDATION_FAILED'): void => {
  if (!validatorFor(schema)(value)) throw new Error(errorCode);
};
