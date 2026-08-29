import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: { user: { create: mocks.create, findUnique: mocks.findUnique } },
}));

import {
  GOOGLE_ACCOUNT_SELECT,
  OAUTH_ACCOUNT_SELECT,
  prismaAuthIdentityRepository,
  SESSION_IDENTITY_SELECT,
} from "../src/modules/auth/infrastructure/prisma-auth-identity.repository.js";

describe("Prisma auth identity repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the exact safe session projection", async () => {
    const identity = { id: "session-user", username: "session", avatar: "avatar" };
    mocks.findUnique.mockResolvedValueOnce(identity);

    await expect(prismaAuthIdentityRepository.findSessionIdentityById(identity.id))
      .resolves.toBe(identity);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: identity.id },
      select: SESSION_IDENTITY_SELECT,
    });
    expect(SESSION_IDENTITY_SELECT).not.toHaveProperty("hashedPassword");
    expect(SESSION_IDENTITY_SELECT).not.toHaveProperty("privateKey");
    expect(SESSION_IDENTITY_SELECT).not.toHaveProperty("avatarCloudinaryPublicId");
  });

  it("preserves a missing session identity", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(prismaAuthIdentityRepository.findSessionIdentityById("deleted-user"))
      .resolves.toBeNull();
  });

  it("looks up the exact OAuth account projection by email", async () => {
    const identity = { id: "oauth-user", email: "oauth@example.test" };
    mocks.findUnique.mockResolvedValueOnce(identity);

    await expect(prismaAuthIdentityRepository.findOAuthIdentityByEmail(identity.email))
      .resolves.toBe(identity);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { email: identity.email },
      select: OAUTH_ACCOUNT_SELECT,
    });
  });

  it("creates a Google identity with the exact data and safe projection", async () => {
    const input = {
      username: "Google User",
      name: "Google",
      avatar: "https://example.test/google.png",
      email: "google@example.test",
      hashedPassword: "obvious-fake-hash",
      emailVerified: true as const,
      oAuthSignup: true as const,
      googleId: "google-provider-id",
    };
    const created = { id: "created-user", ...input };
    mocks.create.mockResolvedValueOnce(created);

    await expect(prismaAuthIdentityRepository.createGoogleIdentity(input)).resolves.toBe(created);
    expect(mocks.create).toHaveBeenCalledWith({
      data: input,
      select: GOOGLE_ACCOUNT_SELECT,
    });
    expect(GOOGLE_ACCOUNT_SELECT).not.toHaveProperty("hashedPassword");
    expect(GOOGLE_ACCOUNT_SELECT).not.toHaveProperty("privateKey");
  });
});
