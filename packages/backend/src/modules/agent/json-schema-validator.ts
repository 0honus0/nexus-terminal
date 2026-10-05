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
  const validator = validatorFor(schema);
  if (!validator(value)) {
    const keywords = [...new Set((validator.errors ?? []).map((error) => error.keyword))].slice(0, 6);
    throw new Error(errorCode, {
      cause: new Error(
        `Arguments do not match the declared schema (${keywords.join(', ')}). Check required fields and allowed properties; do not repeat unchanged arguments. The tool was not executed.`,
      ),
    });
  }
};
