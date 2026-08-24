import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieSet } = vi.hoisted(() => ({ cookieSet: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet, delete: vi.fn() }),
}));

import {
  createSession,
  signPasswordResetToken,
  signPrivateKeyRecoveryToken,
  signSessionToken,
  TOKEN_TYPES,
  verifyOAuthExchangeToken,
  verifyPasswordResetToken,
  verifyPrivateKeyRecoveryToken,
  verifySessionToken,
} from "../src/lib/server/session";
import {
  SESSION_TOKEN_AUDIENCES,
  TOKEN_AUDIENCES,
  TOKEN_ISSUERS,
} from "../src/lib/server/token.constants";

const JWT_SECRET = "phase-1c-1a-test-secret";
const USER_ID = "token-purpose-user";
const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000);
const encodedSecret = () => new TextEncoder().encode(JWT_SECRET);

const signRawToken = async ({
  tokenType,
  algorithm = "HS256",
  expiresAt = futureExpiry(),
  issuer = tokenType === TOKEN_TYPES.OAUTH_EXCHANGE ? TOKEN_ISSUERS.API : TOKEN_ISSUERS.WEB,
  audience = tokenType === TOKEN_TYPES.SESSION || tokenType === undefined
    ? [...SESSION_TOKEN_AUDIENCES]
    : TOKEN_AUDIENCES.WEB,
  includeIssuer = true,
  includeAudience = true,
}: {
  tokenType?: string;
  algorithm?: "HS256" | "HS384";
  expiresAt?: Date;
  issuer?: string;
  audience?: string | string[];
  includeIssuer?: boolean;
  includeAudience?: boolean;
}) => {
  let signer = new SignJWT({
    ...(tokenType ? { tokenType } : {}),
    userId: USER_ID,
    expiresAt: expiresAt.toISOString(),
    ...(tokenType === TOKEN_TYPES.OAUTH_EXCHANGE ? { isNewUser: false } : {}),
  })
    .setProtectedHeader({ alg: algorithm })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000));

  if (includeIssuer) {
    signer = signer.setIssuer(issuer);
  }
  if (includeAudience) {
    signer = signer.setAudience(audience);
  }

  return signer.sign(encodedSecret());
};

describe("frontend token-purpose APIs", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    cookieSet.mockClear();
  });

  it("accepts a valid session token in the session verifier", async () => {
    const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });

    await expect(verifySessionToken(token)).resolves.toMatchObject({
      tokenType: TOKEN_TYPES.SESSION,
      userId: USER_ID,
      iss: TOKEN_ISSUERS.WEB,
      aud: [...SESSION_TOKEN_AUDIENCES],
    });
  });

  it("createSession returns the same purpose-bound session JWT that it stores", async () => {
    const token = await createSession(USER_ID);

    await expect(verifySessionToken(token)).resolves.toMatchObject({
      tokenType: TOKEN_TYPES.SESSION,
      userId: USER_ID,
    });
    expect(cookieSet).toHaveBeenCalledWith("session", token, expect.any(Object));
  });

  it.each([
    TOKEN_TYPES.PASSWORD_RESET,
    TOKEN_TYPES.PRIVATE_KEY_RECOVERY,
    TOKEN_TYPES.OAUTH_EXCHANGE,
    undefined,
  ])("rejects %s tokens in the session verifier", async (tokenType) => {
    await expect(verifySessionToken(await signRawToken({ tokenType }))).resolves.toBeNull();
  });

  it("rejects a session token in every non-session verifier", async () => {
    const sessionToken = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });

    await expect(verifyPasswordResetToken(sessionToken)).resolves.toBeNull();
    await expect(verifyPrivateKeyRecoveryToken(sessionToken)).resolves.toBeNull();
    await expect(verifyOAuthExchangeToken(sessionToken)).resolves.toBeNull();
  });

  it("accepts each token only in its own purpose verifier", async () => {
    const passwordResetToken = await signPasswordResetToken({
      userId: USER_ID,
      expiresAt: futureExpiry(),
    });
    const privateKeyRecoveryToken = await signPrivateKeyRecoveryToken({
      userId: USER_ID,
      expiresAt: futureExpiry(),
    });
    const oauthExchangeToken = await signRawToken({ tokenType: TOKEN_TYPES.OAUTH_EXCHANGE });

    await expect(verifyPasswordResetToken(passwordResetToken)).resolves.toMatchObject({
      tokenType: TOKEN_TYPES.PASSWORD_RESET,
      iss: TOKEN_ISSUERS.WEB,
      aud: TOKEN_AUDIENCES.WEB,
    });
    await expect(verifyPrivateKeyRecoveryToken(privateKeyRecoveryToken)).resolves.toMatchObject({
      tokenType: TOKEN_TYPES.PRIVATE_KEY_RECOVERY,
      iss: TOKEN_ISSUERS.WEB,
      aud: TOKEN_AUDIENCES.WEB,
    });
    await expect(verifyOAuthExchangeToken(oauthExchangeToken)).resolves.toMatchObject({
      tokenType: TOKEN_TYPES.OAUTH_EXCHANGE,
      isNewUser: false,
      iss: TOKEN_ISSUERS.API,
      aud: TOKEN_AUDIENCES.WEB,
    });
  });

  it("rejects every correct-purpose token when its issuer is wrong", async () => {
    const sessionToken = await signRawToken({
      tokenType: TOKEN_TYPES.SESSION,
      issuer: TOKEN_ISSUERS.API,
    });
    const passwordResetToken = await signRawToken({
      tokenType: TOKEN_TYPES.PASSWORD_RESET,
      issuer: TOKEN_ISSUERS.API,
    });
    const privateKeyRecoveryToken = await signRawToken({
      tokenType: TOKEN_TYPES.PRIVATE_KEY_RECOVERY,
      issuer: TOKEN_ISSUERS.API,
    });
    const oauthExchangeToken = await signRawToken({
      tokenType: TOKEN_TYPES.OAUTH_EXCHANGE,
      issuer: TOKEN_ISSUERS.WEB,
    });

    await expect(verifySessionToken(sessionToken)).resolves.toBeNull();
    await expect(verifyPasswordResetToken(passwordResetToken)).resolves.toBeNull();
    await expect(verifyPrivateKeyRecoveryToken(privateKeyRecoveryToken)).resolves.toBeNull();
    await expect(verifyOAuthExchangeToken(oauthExchangeToken)).resolves.toBeNull();
  });

  it("rejects every correct-purpose token when its audience is wrong", async () => {
    const sessionToken = await signRawToken({
      tokenType: TOKEN_TYPES.SESSION,
      audience: [TOKEN_AUDIENCES.WEB, TOKEN_AUDIENCES.SOCKET],
    });
    const passwordResetToken = await signRawToken({
      tokenType: TOKEN_TYPES.PASSWORD_RESET,
      audience: TOKEN_AUDIENCES.API,
    });
    const privateKeyRecoveryToken = await signRawToken({
      tokenType: TOKEN_TYPES.PRIVATE_KEY_RECOVERY,
      audience: TOKEN_AUDIENCES.SOCKET,
    });
    const oauthExchangeToken = await signRawToken({
      tokenType: TOKEN_TYPES.OAUTH_EXCHANGE,
      audience: TOKEN_AUDIENCES.API,
    });

    await expect(verifySessionToken(sessionToken)).resolves.toBeNull();
    await expect(verifyPasswordResetToken(passwordResetToken)).resolves.toBeNull();
    await expect(verifyPrivateKeyRecoveryToken(privateKeyRecoveryToken)).resolves.toBeNull();
    await expect(verifyOAuthExchangeToken(oauthExchangeToken)).resolves.toBeNull();
  });

  it("rejects every correct-purpose token with a missing issuer", async () => {
    const sessionToken = await signRawToken({
      tokenType: TOKEN_TYPES.SESSION,
      includeIssuer: false,
    });
    const passwordResetToken = await signRawToken({
      tokenType: TOKEN_TYPES.PASSWORD_RESET,
      includeIssuer: false,
    });
    const privateKeyRecoveryToken = await signRawToken({
      tokenType: TOKEN_TYPES.PRIVATE_KEY_RECOVERY,
      includeIssuer: false,
    });
    const oauthExchangeToken = await signRawToken({
      tokenType: TOKEN_TYPES.OAUTH_EXCHANGE,
      includeIssuer: false,
    });

    await expect(verifySessionToken(sessionToken)).resolves.toBeNull();
    await expect(verifyPasswordResetToken(passwordResetToken)).resolves.toBeNull();
    await expect(verifyPrivateKeyRecoveryToken(privateKeyRecoveryToken)).resolves.toBeNull();
    await expect(verifyOAuthExchangeToken(oauthExchangeToken)).resolves.toBeNull();
  });

  it("rejects every correct-purpose token with a missing audience", async () => {
    const sessionToken = await signRawToken({
      tokenType: TOKEN_TYPES.SESSION,
      includeAudience: false,
    });
    const passwordResetToken = await signRawToken({
      tokenType: TOKEN_TYPES.PASSWORD_RESET,
      includeAudience: false,
    });
    const privateKeyRecoveryToken = await signRawToken({
      tokenType: TOKEN_TYPES.PRIVATE_KEY_RECOVERY,
      includeAudience: false,
    });
    const oauthExchangeToken = await signRawToken({
      tokenType: TOKEN_TYPES.OAUTH_EXCHANGE,
      includeAudience: false,
    });

    await expect(verifySessionToken(sessionToken)).resolves.toBeNull();
    await expect(verifyPasswordResetToken(passwordResetToken)).resolves.toBeNull();
    await expect(verifyPrivateKeyRecoveryToken(privateKeyRecoveryToken)).resolves.toBeNull();
    await expect(verifyOAuthExchangeToken(oauthExchangeToken)).resolves.toBeNull();
  });

  it("does not allow caller input to override a signer's purpose", async () => {
    const token = await signSessionToken({
      userId: USER_ID,
      expiresAt: futureExpiry(),
      tokenType: TOKEN_TYPES.PASSWORD_RESET,
      issuer: TOKEN_ISSUERS.API,
      audience: TOKEN_AUDIENCES.WEB,
    } as Parameters<typeof signSessionToken>[0]);

    await expect(verifySessionToken(token)).resolves.toMatchObject({
      tokenType: TOKEN_TYPES.SESSION,
      iss: TOKEN_ISSUERS.WEB,
      aud: [...SESSION_TOKEN_AUDIENCES],
    });
    await expect(verifyPasswordResetToken(token)).resolves.toBeNull();
  });

  it("rejects tokens signed with a non-HS256 algorithm", async () => {
    const token = await signRawToken({ tokenType: TOKEN_TYPES.SESSION, algorithm: "HS384" });

    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("rejects expired tokens even when their purpose is correct", async () => {
    const token = await signRawToken({
      tokenType: TOKEN_TYPES.SESSION,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    await expect(verifySessionToken(token)).resolves.toBeNull();
  });
});
