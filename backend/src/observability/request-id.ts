import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "X-Request-Id";
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const REQUEST_ID_MAX_LENGTH = 64;

export const isValidRequestId = (value: unknown): value is string =>
  typeof value === "string" && REQUEST_ID_PATTERN.test(value);

export const selectRequestId = (
  suppliedValue: unknown,
  generate: () => string = randomUUID,
): string => isValidRequestId(suppliedValue) ? suppliedValue : generate();
