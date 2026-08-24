import "server-only";

import type { RecoveryKeyWrapV2 } from "@/lib/client/privateKeyEnvelope";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const RECOVERY_KEK_VERSION = 1 as const;
const RECOVERY_KEK_BYTES = 32;
const RECOVERY_SECRET_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const RECOVERY_AAD_PREFIX = "nexuschat:private-key-recovery:v2:";

const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const UNPADDED_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type PrivateKeyRecoveryKeyWrapErrorCode =
  | "CONFIGURATION_ERROR"
  | "RECOVERY_FAILED";

export class PrivateKeyRecoveryKeyWrapError extends Error {
  readonly code: PrivateKeyRecoveryKeyWrapErrorCode;

  constructor(
    code: PrivateKeyRecoveryKeyWrapErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PrivateKeyRecoveryKeyWrapError";
    this.code = code;
  }
}

const configurationError = () =>
  new PrivateKeyRecoveryKeyWrapError(
    "CONFIGURATION_ERROR",
    "Private-key recovery is not configured."
  );

const recoveryError = () =>
  new PrivateKeyRecoveryKeyWrapError(
    "RECOVERY_FAILED",
    "Private-key recovery failed."
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
) => {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
};

const decodeCanonicalBase64 = (value: string) => {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64_PATTERN.test(value)
  ) {
    return null;
  }

  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
};

const decodeCanonicalUnpaddedBase64Url = (value: string) => {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    !UNPADDED_BASE64URL_PATTERN.test(value)
  ) {
    return null;
  }

  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : null;
};

const getRecoveryKek = (kekVersion: number) => {
  if (kekVersion !== RECOVERY_KEK_VERSION) {
    throw recoveryError();
  }

  const encodedKek = process.env.PRIVATE_KEY_RECOVERY_KEK_V1;
  if (!encodedKek) {
    throw configurationError();
  }

  const kek = decodeCanonicalBase64(encodedKek);
  if (kek?.byteLength !== RECOVERY_KEK_BYTES) {
    throw configurationError();
  }

  return kek;
};

const getRecoveryAad = (userId: string) => {
  if (userId.length === 0) {
    throw recoveryError();
  }
  return Buffer.from(`${RECOVERY_AAD_PREFIX}${userId}`, "utf8");
};

const validateRecoverySecret = (recoverySecret: string) => {
  const bytes = decodeCanonicalUnpaddedBase64Url(recoverySecret);
  if (bytes?.byteLength !== RECOVERY_SECRET_BYTES) {
    throw recoveryError();
  }
  return recoverySecret;
};

const validateRecoveryKeyWrap = (
  value: unknown
): RecoveryKeyWrapV2 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["algorithm", "kekVersion", "iv", "ciphertext"]) ||
    value.algorithm !== "AES-256-GCM" ||
    typeof value.kekVersion !== "number" ||
    !Number.isSafeInteger(value.kekVersion) ||
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    throw recoveryError();
  }

  const iv = decodeCanonicalBase64(value.iv);
  const ciphertext = decodeCanonicalBase64(value.ciphertext);
  if (
    iv?.byteLength !== AES_GCM_IV_BYTES ||
    !ciphertext ||
    ciphertext.byteLength <= AES_GCM_TAG_BYTES
  ) {
    throw recoveryError();
  }

  return {
    algorithm: value.algorithm,
    kekVersion: value.kekVersion,
    iv: value.iv,
    ciphertext: value.ciphertext,
  };
};

export const generatePerUserRecoverySecret = () =>
  randomBytes(RECOVERY_SECRET_BYTES).toString("base64url");

export const wrapRecoverySecret = ({
  userId,
  recoverySecret,
}: {
  userId: string;
  recoverySecret: string;
}): RecoveryKeyWrapV2 => {
  const validatedRecoverySecret = validateRecoverySecret(recoverySecret);
  const kek = getRecoveryKek(RECOVERY_KEK_VERSION);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  cipher.setAAD(getRecoveryAad(userId));

  const ciphertext = Buffer.concat([
    cipher.update(validatedRecoverySecret, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return {
    algorithm: "AES-256-GCM",
    kekVersion: RECOVERY_KEK_VERSION,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
};

export const unwrapRecoverySecret = ({
  userId,
  recoveryKeyWrap,
}: {
  userId: string;
  recoveryKeyWrap: unknown;
}) => {
  const validatedRecoveryKeyWrap = validateRecoveryKeyWrap(recoveryKeyWrap);
  const kek = getRecoveryKek(validatedRecoveryKeyWrap.kekVersion);
  const iv = decodeCanonicalBase64(validatedRecoveryKeyWrap.iv);
  const ciphertextWithTag = decodeCanonicalBase64(
    validatedRecoveryKeyWrap.ciphertext
  );

  if (!iv || !ciphertextWithTag) {
    throw recoveryError();
  }

  const ciphertext = ciphertextWithTag.subarray(
    0,
    ciphertextWithTag.byteLength - AES_GCM_TAG_BYTES
  );
  const authenticationTag = ciphertextWithTag.subarray(
    ciphertextWithTag.byteLength - AES_GCM_TAG_BYTES
  );

  try {
    const decipher = createDecipheriv("aes-256-gcm", kek, iv);
    decipher.setAAD(getRecoveryAad(userId));
    decipher.setAuthTag(authenticationTag);
    const recoverySecret = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    return validateRecoverySecret(recoverySecret);
  } catch (error) {
    if (error instanceof PrivateKeyRecoveryKeyWrapError) {
      throw error;
    }
    throw recoveryError();
  }
};

export { RECOVERY_KEK_VERSION };
