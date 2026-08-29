import { describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/auth/infrastructure/prisma-auth-identity.repository.js", () => ({
  prismaAuthIdentityRepository: {
    findOAuthIdentityByEmail: vi.fn(),
    createGoogleIdentity: vi.fn(),
  },
}));

import { createGoogleAccountProvisioner } from "../src/modules/auth/application/provision-google-account.js";

const PROFILE = {
  providerId: "google-profile-id",
  email: "google-profile@example.test",
  displayName: "Google Profile",
  givenName: "Google",
  avatarUrl: "https://example.test/google.png",
};

describe("Google account provisioning application operation", () => {
  it("returns an existing account without hashing or creating", async () => {
    const existing = {
      id: "existing-user",
      username: "existing",
      name: "Existing",
      avatar: "existing-avatar",
      email: PROFILE.email,
      emailVerified: true,
    };
    const identityRepository = {
      findOAuthIdentityByEmail: vi.fn().mockResolvedValue(existing),
      createGoogleIdentity: vi.fn(),
    };
    const hashProviderId = vi.fn();
    const provision = createGoogleAccountProvisioner({
      identityRepository,
      hashProviderId,
      defaultAvatar: "default-avatar",
    });

    await expect(provision(PROFILE)).resolves.toEqual({
      ...existing,
      googleId: PROFILE.providerId,
      newUser: false,
    });
    expect(identityRepository.findOAuthIdentityByEmail).toHaveBeenCalledWith(PROFILE.email);
    expect(hashProviderId).not.toHaveBeenCalled();
    expect(identityRepository.createGoogleIdentity).not.toHaveBeenCalled();
  });

  it("hashes and creates a new account with the existing defaults", async () => {
    const created = {
      id: "new-user",
      username: PROFILE.displayName,
      name: PROFILE.givenName,
      avatar: PROFILE.avatarUrl,
      email: PROFILE.email,
      emailVerified: true,
      googleId: PROFILE.providerId,
    };
    const identityRepository = {
      findOAuthIdentityByEmail: vi.fn().mockResolvedValue(null),
      createGoogleIdentity: vi.fn().mockResolvedValue(created),
    };
    const hashProviderId = vi.fn().mockResolvedValue("obvious-fake-hash");
    const provision = createGoogleAccountProvisioner({
      identityRepository,
      hashProviderId,
      defaultAvatar: "default-avatar",
    });

    await expect(provision(PROFILE)).resolves.toEqual({ ...created, newUser: true });
    expect(hashProviderId).toHaveBeenCalledWith(PROFILE.providerId, 10);
    expect(identityRepository.createGoogleIdentity).toHaveBeenCalledWith({
      username: PROFILE.displayName,
      name: PROFILE.givenName,
      avatar: PROFILE.avatarUrl,
      email: PROFILE.email,
      hashedPassword: "obvious-fake-hash",
      emailVerified: true,
      oAuthSignup: true,
      googleId: PROFILE.providerId,
    });
  });

  it("uses the injected default avatar when no provider photo exists", async () => {
    const identityRepository = {
      findOAuthIdentityByEmail: vi.fn().mockResolvedValue(null),
      createGoogleIdentity: vi.fn().mockImplementation(async (input) => ({
        id: "new-user",
        ...input,
        googleId: input.googleId,
      })),
    };
    const provision = createGoogleAccountProvisioner({
      identityRepository,
      hashProviderId: vi.fn().mockResolvedValue("obvious-fake-hash"),
      defaultAvatar: "default-avatar",
    });

    await provision({ ...PROFILE, avatarUrl: undefined });
    expect(identityRepository.createGoogleIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ avatar: "default-avatar" }),
    );
  });

  it.each(["lookup", "hash", "create"])(
    "sanitizes %s failures",
    async (failurePoint) => {
      const identityRepository = {
        findOAuthIdentityByEmail: vi.fn().mockImplementation(async () => {
          if (failurePoint === "lookup") throw new Error("private lookup detail");
          return null;
        }),
        createGoogleIdentity: vi.fn().mockImplementation(async () => {
          if (failurePoint === "create") throw new Error("private create detail");
          throw new Error("unexpected create call");
        }),
      };
      const hashProviderId = vi.fn().mockImplementation(async () => {
        if (failurePoint === "hash") throw new Error("private hash detail");
        return "obvious-fake-hash";
      });
      const provision = createGoogleAccountProvisioner({
        identityRepository,
        hashProviderId,
        defaultAvatar: "default-avatar",
      });

      await expect(provision(PROFILE)).rejects.toMatchObject({
        code: "GOOGLE_ACCOUNT_PROVISIONING_FAILED",
        message: "Google account provisioning failed.",
      });
    },
  );
});
