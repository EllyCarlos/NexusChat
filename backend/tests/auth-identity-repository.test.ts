import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  queryRaw: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    user: {
      create: mocks.create,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  GOOGLE_ACCOUNT_SELECT,
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

  it("looks up a Google account by its unique provider ID", async () => {
    const identity = { id: "oauth-user", googleId: "google-provider-id" };
    mocks.findUnique.mockResolvedValueOnce(identity);

    await expect(prismaAuthIdentityRepository.findGoogleIdentityByProviderId(identity.googleId))
      .resolves.toBe(identity);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { googleId: identity.googleId },
      select: GOOGLE_ACCOUNT_SELECT,
    });
  });

  it("looks up the safe Google account projection by email", async () => {
    const identity = { id: "oauth-user", email: "oauth@example.test", googleId: null };
    mocks.queryRaw.mockResolvedValueOnce([{ id: identity.id }]);
    mocks.findUnique.mockResolvedValueOnce(identity);

    await expect(prismaAuthIdentityRepository.findGoogleIdentityByEmail(
      " OAuth@Example.Test ",
    ))
      .resolves.toBe(identity);
    const canonicalQuery = mocks.queryRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    expect(canonicalQuery.strings.join(" ")).toContain('LOWER(TRIM("email"))');
    expect(canonicalQuery.values).toEqual([identity.email]);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: identity.id },
      select: GOOGLE_ACCOUNT_SELECT,
    });
    expect(GOOGLE_ACCOUNT_SELECT).not.toHaveProperty("hashedPassword");
    expect(GOOGLE_ACCOUNT_SELECT).not.toHaveProperty("privateKey");
    expect(GOOGLE_ACCOUNT_SELECT).not.toHaveProperty("publicKey");
    expect(GOOGLE_ACCOUNT_SELECT).not.toHaveProperty("oAuthSignup");
  });

  it("returns no identity when the canonical email has no match", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    await expect(prismaAuthIdentityRepository.findGoogleIdentityByEmail(
      "missing@example.test",
    )).resolves.toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("fails closed when historical rows share a canonical email", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { id: "first-user" },
      { id: "second-user" },
    ]);

    await expect(prismaAuthIdentityRepository.findGoogleIdentityByEmail(
      "user@example.test",
    )).rejects.toThrow("same canonical email");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("links only googleId when the account is still unlinked", async () => {
    const linked = { id: "manual-user", googleId: "google-provider-id" };
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.findUnique.mockResolvedValueOnce(linked);

    await expect(prismaAuthIdentityRepository.linkGoogleIdentity({
      userId: linked.id,
      googleId: linked.googleId,
    })).resolves.toBe(linked);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: linked.id, googleId: null },
      data: { googleId: linked.googleId },
    });
    const updateData = mocks.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).not.toHaveProperty("oAuthSignup");
    expect(updateData).not.toHaveProperty("hashedPassword");
    expect(updateData).not.toHaveProperty("privateKey");
    expect(updateData).not.toHaveProperty("publicKey");
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: linked.id },
      select: GOOGLE_ACCOUNT_SELECT,
    });
  });

  it("treats an already-correct concurrent link as idempotent", async () => {
    const linked = { id: "manual-user", googleId: "google-provider-id" };
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findUnique.mockResolvedValueOnce(linked);

    await expect(prismaAuthIdentityRepository.linkGoogleIdentity({
      userId: linked.id,
      googleId: linked.googleId,
    })).resolves.toBe(linked);
  });

  it("refuses a concurrent overwrite with a different provider ID", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findUnique.mockResolvedValueOnce({
      id: "manual-user",
      googleId: "original-google-id",
    });

    await expect(prismaAuthIdentityRepository.linkGoogleIdentity({
      userId: "manual-user",
      googleId: "different-google-id",
    })).resolves.toBeNull();
  });

  it("propagates a database uniqueness conflict for fail-closed normalization", async () => {
    const uniqueConflict = Object.assign(new Error("unique constraint"), { code: "P2002" });
    mocks.updateMany.mockRejectedValueOnce(uniqueConflict);

    await expect(prismaAuthIdentityRepository.linkGoogleIdentity({
      userId: "manual-user",
      googleId: "already-owned-google-id",
    })).rejects.toBe(uniqueConflict);
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
  });
});
