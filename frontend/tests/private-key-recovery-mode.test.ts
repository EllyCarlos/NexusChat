import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import { getPrivateKeyRecoveryPresentation } from "../src/lib/client/privateKeyRecoveryPresentation";
import { derivePrivateKeyRecoveryMode } from "../src/lib/server/privateKeyRecoveryMode";

const base64Bytes = (byteLength: number, fill: number) =>
  Buffer.alloc(byteLength, fill).toString("base64");

const LEGACY_V1_BACKUP = base64Bytes(45, 1);
const OAUTH_V2_BACKUP = JSON.stringify({
  version: 2,
  cipher: {
    name: "AES-256-GCM",
    iv: base64Bytes(12, 2),
  },
  kdf: {
    name: "PBKDF2-SHA-256",
    iterations: 100_000,
    salt: base64Bytes(16, 3),
  },
  ciphertext: base64Bytes(17, 4),
  recoveryKeyWrap: {
    algorithm: "AES-256-GCM",
    kekVersion: 1,
    iv: base64Bytes(12, 5),
    ciphertext: base64Bytes(17, 6),
  },
});

describe("private-key recovery mode", () => {
  it("routes a manual legacy backup to manual-v1", () => {
    expect(derivePrivateKeyRecoveryMode({
      privateKey: LEGACY_V1_BACKUP,
      oAuthSignup: false,
    })).toBe("manual-v1");
  });

  it("routes an OAuth legacy backup to oauth-v1", () => {
    expect(derivePrivateKeyRecoveryMode({
      privateKey: LEGACY_V1_BACKUP,
      oAuthSignup: true,
    })).toBe("oauth-v1");
  });

  it("routes an OAuth V2 envelope to oauth-v2", () => {
    expect(derivePrivateKeyRecoveryMode({
      privateKey: OAUTH_V2_BACKUP,
      oAuthSignup: true,
    })).toBe("oauth-v2");
  });

  it("fails closed for a V2 envelope with manual lineage", () => {
    expect(() => derivePrivateKeyRecoveryMode({
      privateKey: OAUTH_V2_BACKUP,
      oAuthSignup: false,
    })).toThrow("lineage is inconsistent");
  });

  it("fails closed for a malformed serialized backup", () => {
    expect(() => derivePrivateKeyRecoveryMode({
      privateKey: "not-a-private-key-backup",
      oAuthSignup: true,
    })).toThrow("format is invalid");
  });

  it("fails closed when no stored backup exists", () => {
    expect(() => derivePrivateKeyRecoveryMode({
      privateKey: null,
      oAuthSignup: false,
    })).toThrow("recovery is unavailable");
  });

  it("keeps a Google-linked manual legacy backup on password recovery", () => {
    expect(getPrivateKeyRecoveryPresentation({
      recoveryMode: "manual-v1",
      googleLinked: true,
    })).toMatchObject({
      recoveryKind: "manual",
      copy: expect.stringContaining("original NexusChat password"),
    });
  });

  it.each(["oauth-v1", "oauth-v2"] as const)(
    "selects email recovery from the explicit %s mode",
    (recoveryMode) => {
      expect(getPrivateKeyRecoveryPresentation({
        recoveryMode,
        googleLinked: false,
      }).recoveryKind).toBe("oauth");
    },
  );

  it("does not need oAuthSignup to choose the client recovery form", () => {
    const clientDecision = getPrivateKeyRecoveryPresentation({
      recoveryMode: "manual-v1",
      googleLinked: true,
    });

    expect(clientDecision.recoveryKind).toBe("manual");
  });
});
