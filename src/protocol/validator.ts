import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";

import { helloSchema, requestSchema, type ProtocolHello, type ProtocolRequest } from "./catalog";

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: readonly string[] };

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateHello = ajv.compile(helloSchema);
const validateRequest = ajv.compile(requestSchema);

export function validateProtocolHello(value: unknown): Validation<ProtocolHello> { return validate(validateHello as ValidateFunction<ProtocolHello>, value); }
export function validateProtocolRequest(value: unknown): Validation<ProtocolRequest> { return validate(validateRequest as ValidateFunction<ProtocolRequest>, value); }

function validate<T>(validator: ValidateFunction<T>, value: unknown): Validation<T> {
  return validator(value) ? { ok: true, value: value as T } : { ok: false, errors: (validator.errors ?? []).map((error) => `${error.instancePath || "/"}: ${error.message ?? error.keyword}`) };
}
