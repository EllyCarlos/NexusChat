const PRIVATE_KEY_BACKUP_V2 = 2 as const;
const V2_CIPHER_NAME = "AES-256-GCM" as const;
const V2_KDF_NAME = "PBKDF2-SHA-256" as const;
const V2_PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const P384_PRIVATE_KEY_COMPONENT_BYTES = 48;
const MINIMUM_ENCRYPTED_CONTENT_BYTES = AES_GCM_TAG_BYTES + 1;
const MINIMUM_LEGACY_BACKUP_BYTES =
  PBKDF2_SALT_BYTES + AES_GCM_IV_BYTES + MINIMUM_ENCRYPTED_CONTENT_BYTES;

const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const UNPADDED_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type PrivateKeyBackupVersion = 1 | typeof PRIVATE_KEY_BACKUP_V2;

export type RecoveryKeyWrapV2 = {
  algorithm: typeof V2_CIPHER_NAME;
  kekVersion: number;
  iv: string;
  ciphertext: string;
};

export type PrivateKeyEnvelopeV2 = {
  version: typeof PRIVATE_KEY_BACKUP_V2;
  cipher: {
    name: typeof V2_CIPHER_NAME;
    iv: string;
  };
  kdf: {
    name: typeof V2_KDF_NAME;
    iterations: number;
    salt: string;
  };
  ciphertext: string;
  recoveryKeyWrap: RecoveryKeyWrapV2;
};

export type ParsedPrivateKeyBackup =
  | {
      format: "legacy-v1";
      version: 1;
      value: string;
    }
  | {
      format: "v2";
      version: typeof PRIVATE_KEY_BACKUP_V2;
      envelope: PrivateKeyEnvelopeV2;
    };

export type PrivateKeyEnvelopeErrorCode =
  | "INVALID_BACKUP"
  | "INVALID_ENVELOPE"
  | "UNSUPPORTED_VERSION"
  | "DECRYPTION_FAILED";

export class PrivateKeyEnvelopeError extends Error {
  readonly code: PrivateKeyEnvelopeErrorCode;

  constructor(code: PrivateKeyEnvelopeErrorCode, message: string) {
    super(message);
    this.name = "PrivateKeyEnvelopeError";
    this.code = code;
  }
}

type EncryptPrivateKeyV2Input = {
  privateKey: JsonWebKey;
  recoverySecret: string;
  recoveryKeyWrap: RecoveryKeyWrapV2;
};

type DecryptPrivateKeyV2Input = {
  envelope: string | PrivateKeyEnvelopeV2;
  recoverySecret: string;
};

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

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const decodeCanonicalBase64 = (value: string, fieldName: string) => {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64_PATTERN.test(value)
  ) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      `${fieldName} must be canonical Base64.`
    );
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      `${fieldName} must be canonical Base64.`
    );
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (bytesToBase64(bytes) !== value) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      `${fieldName} must be canonical Base64.`
    );
  }

  return bytes;
};

const decodeCanonicalUnpaddedBase64Url = (value: string) => {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    !UNPADDED_BASE64URL_PATTERN.test(value)
  ) {
    return null;
  }

  const paddingLength = (4 - (value.length % 4)) % 4;
  const paddedBase64 = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat(
    paddingLength
  )}`;

  let binary: string;
  try {
    binary = atob(paddedBase64);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const canonicalValue = bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return canonicalValue === value ? bytes : null;
};

const assertBase64ByteLength = (
  value: string,
  fieldName: string,
  expectedByteLength: number
) => {
  const bytes = decodeCanonicalBase64(value, fieldName);
  if (bytes.byteLength !== expectedByteLength) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      `${fieldName} has an invalid byte length.`
    );
  }
  return bytes;
};

const assertMinimumBase64ByteLength = (
  value: string,
  fieldName: string,
  minimumByteLength: number
) => {
  const bytes = decodeCanonicalBase64(value, fieldName);
  if (bytes.byteLength < minimumByteLength) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      `${fieldName} is too short.`
    );
  }
  return bytes;
};

const validateRecoveryKeyWrapV2 = (value: unknown): RecoveryKeyWrapV2 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["algorithm", "kekVersion", "iv", "ciphertext"])
  ) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      "Recovery-key wrapping metadata is invalid."
    );
  }

  const { algorithm, kekVersion, iv, ciphertext } = value;
  if (algorithm !== V2_CIPHER_NAME) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      "Recovery-key wrapping algorithm is unsupported."
    );
  }
  if (
    typeof kekVersion !== "number" ||
    !Number.isSafeInteger(kekVersion) ||
    kekVersion < 1
  ) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      "Recovery-key KEK version is invalid."
    );
  }
  if (typeof iv !== "string" || typeof ciphertext !== "string") {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      "Recovery-key wrapping data is invalid."
    );
  }

  assertBase64ByteLength(iv, "recoveryKeyWrap.iv", AES_GCM_IV_BYTES);
  assertMinimumBase64ByteLength(
    ciphertext,
    "recoveryKeyWrap.ciphertext",
    MINIMUM_ENCRYPTED_CONTENT_BYTES
  );

  return {
    algorithm,
    kekVersion,
    iv,
    ciphertext,
  };
};

export const validatePrivateKeyEnvelopeV2 = (
  value: unknown
): PrivateKeyEnvelopeV2 => {
  if (!isRecord(value)) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      "Private-key envelope must be an object."
    );
  }

  if ("version" in value && value.version !== PRIVATE_KEY_BACKUP_V2) {
    throw new PrivateKeyEnvelopeError(
      "UNSUPPORTED_VERSION",
      "Private-key backup version is unsupported."
    );
  }

  if (
    !hasExactKeys(value, [
      "version",
      "cipher",
      "kdf",
      "ciphertext",
      "recoveryKeyWrap",
    ]) ||
    value.version !== PRIVATE_KEY_BACKUP_V2 ||
    !isRecord(value.cipher) ||
    !isRecord(value.kdf) ||
    typeof value.ciphertext !== "string"
  ) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      "Private-key envelope structure is invalid."
    );
  }

  if (
    !hasExactKeys(value.cipher, ["name", "iv"]) ||
    value.cipher.name !== V2_CIPHER_NAME ||
    typeof value.cipher.iv !== "string"
  ) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      "Private-key cipher metadata is invalid."
    );
  }

  if (
    !hasExactKeys(value.kdf, ["name", "iterations", "salt"]) ||
    value.kdf.name !== V2_KDF_NAME ||
    value.kdf.iterations !== V2_PBKDF2_ITERATIONS ||
    typeof value.kdf.salt !== "string"
  ) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      "Private-key KDF metadata is invalid."
    );
  }

  assertBase64ByteLength(value.cipher.iv, "cipher.iv", AES_GCM_IV_BYTES);
  assertBase64ByteLength(value.kdf.salt, "kdf.salt", PBKDF2_SALT_BYTES);
  assertMinimumBase64ByteLength(
    value.ciphertext,
    "ciphertext",
    MINIMUM_ENCRYPTED_CONTENT_BYTES
  );

  return {
    version: PRIVATE_KEY_BACKUP_V2,
    cipher: {
      name: V2_CIPHER_NAME,
      iv: value.cipher.iv,
    },
    kdf: {
      name: V2_KDF_NAME,
      iterations: value.kdf.iterations,
      salt: value.kdf.salt,
    },
    ciphertext: value.ciphertext,
    recoveryKeyWrap: validateRecoveryKeyWrapV2(value.recoveryKeyWrap),
  };
};

export const parsePrivateKeyEnvelopeV2 = (
  serializedEnvelope: string
): PrivateKeyEnvelopeV2 => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedEnvelope) as unknown;
  } catch {
    throw new PrivateKeyEnvelopeError(
      "INVALID_ENVELOPE",
      "Private-key envelope JSON is malformed."
    );
  }
  return validatePrivateKeyEnvelopeV2(parsed);
};

export const serializePrivateKeyEnvelopeV2 = (
  envelope: PrivateKeyEnvelopeV2
) => JSON.stringify(validatePrivateKeyEnvelopeV2(envelope));

const validateLegacyPrivateKeyBackup = (value: string) => {
  let bytes: Uint8Array;
  try {
    bytes = decodeCanonicalBase64(value, "Legacy private-key backup");
  } catch {
    throw new PrivateKeyEnvelopeError(
      "INVALID_BACKUP",
      "Private-key backup format is invalid."
    );
  }

  if (bytes.byteLength < MINIMUM_LEGACY_BACKUP_BYTES) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_BACKUP",
      "Legacy private-key backup is too short."
    );
  }
};

export const parsePrivateKeyBackup = (
  serializedBackup: string
): ParsedPrivateKeyBackup => {
  const value = serializedBackup.trim();
  if (value.length === 0) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_BACKUP",
      "Private-key backup is empty."
    );
  }

  if (value.startsWith("{")) {
    const envelope = parsePrivateKeyEnvelopeV2(value);
    return {
      format: "v2",
      version: PRIVATE_KEY_BACKUP_V2,
      envelope,
    };
  }

  validateLegacyPrivateKeyBackup(value);
  return {
    format: "legacy-v1",
    version: 1,
    value,
  };
};

const getWebCrypto = () => {
  if (!globalThis.crypto?.subtle) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_BACKUP",
      "Web Crypto API is unavailable."
    );
  }
  return globalThis.crypto;
};

const assertRecoverySecret = (recoverySecret: string) => {
  if (recoverySecret.length === 0) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_BACKUP",
      "Recovery material is required."
    );
  }
};

const derivePrivateKeyEncryptionKey = async ({
  recoverySecret,
  salt,
  iterations,
}: {
  recoverySecret: string;
  salt: Uint8Array<ArrayBuffer>;
  iterations: number;
}) => {
  const crypto = getWebCrypto();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(recoverySecret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

const isP384PrivateKeyComponent = (value: unknown) => {
  if (typeof value !== "string") {
    return false;
  }
  return (
    decodeCanonicalUnpaddedBase64Url(value)?.byteLength ===
    P384_PRIVATE_KEY_COMPONENT_BYTES
  );
};

const isNexusChatPrivateJsonWebKey = (
  value: unknown
): value is JsonWebKey =>
  isRecord(value) &&
  value.kty === "EC" &&
  value.crv === "P-384" &&
  isP384PrivateKeyComponent(value.x) &&
  isP384PrivateKeyComponent(value.y) &&
  isP384PrivateKeyComponent(value.d);

const isNexusChatPublicJsonWebKey = (
  value: unknown
): value is JsonWebKey =>
  isRecord(value) &&
  value.kty === "EC" &&
  value.crv === "P-384" &&
  isP384PrivateKeyComponent(value.x) &&
  isP384PrivateKeyComponent(value.y) &&
  !Object.prototype.hasOwnProperty.call(value, "d");

const validateNexusChatPrivateJsonWebKeyForPurpose = async (
  value: unknown,
  errorCode: PrivateKeyEnvelopeErrorCode,
  errorMessage: string
): Promise<JsonWebKey> => {
  if (!isNexusChatPrivateJsonWebKey(value)) {
    throw new PrivateKeyEnvelopeError(errorCode, errorMessage);
  }

  try {
    await getWebCrypto().subtle.importKey(
      "jwk",
      value,
      { name: "ECDH", namedCurve: "P-384" },
      false,
      ["deriveKey"]
    );
  } catch {
    throw new PrivateKeyEnvelopeError(errorCode, errorMessage);
  }

  return value;
};

export const validateNexusChatPrivateJsonWebKey = async (
  value: unknown
): Promise<JsonWebKey> =>
  validateNexusChatPrivateJsonWebKeyForPurpose(
    value,
    "INVALID_BACKUP",
    "A valid NexusChat P-384 private JWK is required."
  );

export const validateNexusChatPublicJsonWebKey = async (
  value: unknown
): Promise<JsonWebKey> => {
  if (!isNexusChatPublicJsonWebKey(value)) {
    throw new PrivateKeyEnvelopeError(
      "INVALID_BACKUP",
      "A valid NexusChat P-384 public JWK is required."
    );
  }

  try {
    await getWebCrypto().subtle.importKey(
      "jwk",
      value,
      { name: "ECDH", namedCurve: "P-384" },
      false,
      []
    );
  } catch {
    throw new PrivateKeyEnvelopeError(
      "INVALID_BACKUP",
      "A valid NexusChat P-384 public JWK is required."
    );
  }

  return value;
};

export const encryptPrivateKeyV2 = async ({
  privateKey,
  recoverySecret,
  recoveryKeyWrap,
}: EncryptPrivateKeyV2Input) => {
  assertRecoverySecret(recoverySecret);
  const validatedPrivateKey = await validateNexusChatPrivateJsonWebKeyForPurpose(
    privateKey,
    "INVALID_BACKUP",
    "A private JWK is required."
  );

  const validatedRecoveryKeyWrap = validateRecoveryKeyWrapV2(recoveryKeyWrap);
  const crypto = getWebCrypto();
  const salt = crypto.getRandomValues(
    new Uint8Array(PBKDF2_SALT_BYTES)
  ) as Uint8Array<ArrayBuffer>;
  const iv = crypto.getRandomValues(
    new Uint8Array(AES_GCM_IV_BYTES)
  ) as Uint8Array<ArrayBuffer>;
  const key = await derivePrivateKeyEncryptionKey({
    recoverySecret,
    salt,
    iterations: V2_PBKDF2_ITERATIONS,
  });
  const plaintext = new TextEncoder().encode(
    JSON.stringify(validatedPrivateKey)
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );

  return serializePrivateKeyEnvelopeV2({
    version: PRIVATE_KEY_BACKUP_V2,
    cipher: {
      name: V2_CIPHER_NAME,
      iv: bytesToBase64(iv),
    },
    kdf: {
      name: V2_KDF_NAME,
      iterations: V2_PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    recoveryKeyWrap: validatedRecoveryKeyWrap,
  });
};

export const decryptPrivateKeyV2 = async ({
  envelope,
  recoverySecret,
}: DecryptPrivateKeyV2Input): Promise<JsonWebKey> => {
  assertRecoverySecret(recoverySecret);
  const validatedEnvelope =
    typeof envelope === "string"
      ? parsePrivateKeyEnvelopeV2(envelope)
      : validatePrivateKeyEnvelopeV2(envelope);

  const salt = assertBase64ByteLength(
    validatedEnvelope.kdf.salt,
    "kdf.salt",
    PBKDF2_SALT_BYTES
  ) as Uint8Array<ArrayBuffer>;
  const iv = assertBase64ByteLength(
    validatedEnvelope.cipher.iv,
    "cipher.iv",
    AES_GCM_IV_BYTES
  ) as Uint8Array<ArrayBuffer>;
  const ciphertext = assertMinimumBase64ByteLength(
    validatedEnvelope.ciphertext,
    "ciphertext",
    MINIMUM_ENCRYPTED_CONTENT_BYTES
  ) as Uint8Array<ArrayBuffer>;

  try {
    const crypto = getWebCrypto();
    const key = await derivePrivateKeyEncryptionKey({
      recoverySecret,
      salt,
      iterations: validatedEnvelope.kdf.iterations,
    });
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    const parsedPrivateKey = JSON.parse(
      new TextDecoder().decode(plaintext)
    ) as unknown;

    return await validateNexusChatPrivateJsonWebKeyForPurpose(
      parsedPrivateKey,
      "DECRYPTION_FAILED",
      "Private-key recovery failed."
    );
  } catch (error) {
    if (error instanceof PrivateKeyEnvelopeError) {
      throw error;
    }
    throw new PrivateKeyEnvelopeError(
      "DECRYPTION_FAILED",
      "Private-key recovery failed."
    );
  }
};

export {
  PRIVATE_KEY_BACKUP_V2,
  V2_CIPHER_NAME,
  V2_KDF_NAME,
  V2_PBKDF2_ITERATIONS,
};
