import { describe, expect, it, vi } from "vitest";

import { createGoogleAccountProvisioner } from "../src/modules/auth/application/provision-google-account.js";

const PROFILE = {
  providerId: "google-profile-id",
  email: "google-profile@example.test",
  emailVerified: true,
  displayName: "Google Profile",
  givenName: "Google",
  avatarUrl: "https://example.test/google.png",
};

const identity = (overrides: Partial<{
  id: string;
  email: string;
  googleId: string | null;
}> = {}) => ({
  id: "existing-user",
  username: "existing",
  name: "Existing",
  avatar: "existing-avatar",
  email: PROFILE.email,
  emailVerified: true,
  googleId: null,
  ...overrides,
});

const createDependencies = () => ({
  identityRepository: {
    findGoogleIdentityByProviderId: vi.fn().mockResolvedValue(null),
    findGoogleIdentityByEmail: vi.fn().mockResolvedValue(null),
    linkGoogleIdentity: vi.fn(),
    createGoogleIdentity: vi.fn(),
  },
  hashProviderId: vi.fn(),
  defaultAvatar: "default-avatar",
});

describe("Google account provisioning application operation", () => {
  it("hashes and creates a new Google account with its provider ID and OAuth lineage", async () => {
    const dependencies = createDependencies();
    const created = identity({ id: "new-user", googleId: PROFILE.providerId });
    dependencies.hashProviderId.mockResolvedValue("obvious-fake-hash");
    dependencies.identityRepository.createGoogleIdentity.mockResolvedValue(created);
    const provision = createGoogleAccountProvisioner(dependencies);

    await expect(provision(PROFILE)).resolves.toEqual({ ...created, newUser: true });
    expect(dependencies.hashProviderId).toHaveBeenCalledWith(PROFILE.providerId, 10);
    expect(dependencies.identityRepository.createGoogleIdentity).toHaveBeenCalledWith({
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

  it("canonicalizes a Google email before matching and creating the account", async () => {
    const dependencies = createDependencies();
    dependencies.hashProviderId.mockResolvedValue("obvious-fake-hash");
    dependencies.identityRepository.createGoogleIdentity.mockResolvedValue(
      identity({ id: "new-user", email: PROFILE.email, googleId: PROFILE.providerId }),
    );
    const provision = createGoogleAccountProvisioner(dependencies);

    await provision({ ...PROFILE, email: " Google-Profile@Example.Test " });

    expect(dependencies.identityRepository.findGoogleIdentityByEmail)
      .toHaveBeenCalledWith(PROFILE.email);
    expect(dependencies.identityRepository.createGoogleIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ email: PROFILE.email }),
    );
  });

  it("returns an already-linked Google account by provider ID without writing", async () => {
    const dependencies = createDependencies();
    const linked = identity({ googleId: PROFILE.providerId });
    dependencies.identityRepository.findGoogleIdentityByProviderId.mockResolvedValue(linked);
    dependencies.identityRepository.findGoogleIdentityByEmail.mockResolvedValue(linked);
    const provision = createGoogleAccountProvisioner(dependencies);

    await expect(provision(PROFILE)).resolves.toEqual({ ...linked, newUser: false });
    expect(dependencies.identityRepository.findGoogleIdentityByProviderId)
      .toHaveBeenCalledWith(PROFILE.providerId);
    expect(dependencies.identityRepository.linkGoogleIdentity).not.toHaveBeenCalled();
    expect(dependencies.hashProviderId).not.toHaveBeenCalled();
    expect(dependencies.identityRepository.createGoogleIdentity).not.toHaveBeenCalled();
  });

  it("allows a returning linked Google identity after its provider email changes", async () => {
    const dependencies = createDependencies();
    const linked = identity({ email: "old@example.test", googleId: PROFILE.providerId });
    dependencies.identityRepository.findGoogleIdentityByProviderId.mockResolvedValue(linked);
    const provision = createGoogleAccountProvisioner(dependencies);

    await expect(provision(PROFILE)).resolves.toEqual({ ...linked, newUser: false });
    expect(dependencies.identityRepository.linkGoogleIdentity).not.toHaveBeenCalled();
  });

  it("atomically links a verified matching-email manual account", async () => {
    const dependencies = createDependencies();
    const manual = identity();
    const linked = identity({ googleId: PROFILE.providerId });
    dependencies.identityRepository.findGoogleIdentityByEmail.mockResolvedValue(manual);
    dependencies.identityRepository.linkGoogleIdentity.mockResolvedValue(linked);
    const provision = createGoogleAccountProvisioner(dependencies);

    await expect(provision(PROFILE)).resolves.toEqual({ ...linked, newUser: false });
    expect(dependencies.identityRepository.linkGoogleIdentity).toHaveBeenCalledWith({
      userId: manual.id,
      googleId: PROFILE.providerId,
    });
    expect(dependencies.identityRepository.linkGoogleIdentity.mock.calls[0]?.[0])
      .toEqual({ userId: manual.id, googleId: PROFILE.providerId });
    expect(dependencies.hashProviderId).not.toHaveBeenCalled();
    expect(dependencies.identityRepository.createGoogleIdentity).not.toHaveBeenCalled();
  });

  it("does not overwrite a different provider ID on a matching-email account", async () => {
    const dependencies = createDependencies();
    dependencies.identityRepository.findGoogleIdentityByEmail.mockResolvedValue(
      identity({ googleId: "original-google-id" }),
    );
    const provision = createGoogleAccountProvisioner(dependencies);

    await expect(provision(PROFILE)).rejects.toMatchObject({
      code: "GOOGLE_ACCOUNT_PROVISIONING_FAILED",
    });
    expect(dependencies.identityRepository.linkGoogleIdentity).not.toHaveBeenCalled();
  });

  it("fails closed when the provider ID and provider email resolve to different accounts", async () => {
    const dependencies = createDependencies();
    dependencies.identityRepository.findGoogleIdentityByProviderId.mockResolvedValue(
      identity({ id: "provider-owner", email: "owner@example.test", googleId: PROFILE.providerId }),
    );
    dependencies.identityRepository.findGoogleIdentityByEmail.mockResolvedValue(
      identity({ id: "email-owner" }),
    );
    const provision = createGoogleAccountProvisioner(dependencies);

    await expect(provision(PROFILE)).rejects.toMatchObject({
      code: "GOOGLE_ACCOUNT_PROVISIONING_FAILED",
    });
    expect(dependencies.identityRepository.linkGoogleIdentity).not.toHaveBeenCalled();
  });

  it("rejects an unverified provider email before linking or creating an account", async () => {
    const dependencies = createDependencies();
    dependencies.identityRepository.findGoogleIdentityByEmail.mockResolvedValue(identity());
    const provision = createGoogleAccountProvisioner(dependencies);

    await expect(provision({ ...PROFILE, emailVerified: false })).rejects.toMatchObject({
      code: "GOOGLE_ACCOUNT_PROVISIONING_FAILED",
    });
    expect(dependencies.identityRepository.findGoogleIdentityByEmail).not.toHaveBeenCalled();
    expect(dependencies.identityRepository.linkGoogleIdentity).not.toHaveBeenCalled();
    expect(dependencies.identityRepository.createGoogleIdentity).not.toHaveBeenCalled();
    expect(dependencies.hashProviderId).not.toHaveBeenCalled();
  });

  it("fails closed if the atomic link loses a race", async () => {
    const dependencies = createDependencies();
    dependencies.identityRepository.findGoogleIdentityByEmail.mockResolvedValue(identity());
    dependencies.identityRepository.linkGoogleIdentity.mockResolvedValue(null);
    const provision = createGoogleAccountProvisioner(dependencies);

    await expect(provision(PROFILE)).rejects.toMatchObject({
      code: "GOOGLE_ACCOUNT_PROVISIONING_FAILED",
    });
  });

  it("keeps a legacy OAuth account's original provider ID", async () => {
    const dependencies = createDependencies();
    const legacyOAuth = identity({ googleId: PROFILE.providerId });
    dependencies.identityRepository.findGoogleIdentityByProviderId.mockResolvedValue(legacyOAuth);
    dependencies.identityRepository.findGoogleIdentityByEmail.mockResolvedValue(legacyOAuth);
    const provision = createGoogleAccountProvisioner(dependencies);

    const result = await provision(PROFILE);

    expect(result.googleId).toBe(PROFILE.providerId);
    expect(dependencies.identityRepository.linkGoogleIdentity).not.toHaveBeenCalled();
  });

  it("uses the injected default avatar when no provider photo exists", async () => {
    const dependencies = createDependencies();
    dependencies.hashProviderId.mockResolvedValue("obvious-fake-hash");
    dependencies.identityRepository.createGoogleIdentity.mockImplementation(async (input) => ({
      ...identity({ id: "new-user", googleId: input.googleId }),
      avatar: input.avatar,
    }));
    const provision = createGoogleAccountProvisioner(dependencies);

    await provision({ ...PROFILE, avatarUrl: undefined });
    expect(dependencies.identityRepository.createGoogleIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ avatar: "default-avatar" }),
    );
  });

  it.each(["provider lookup", "email lookup", "hash", "create"])(
    "sanitizes %s failures",
    async (failurePoint) => {
      const dependencies = createDependencies();
      dependencies.identityRepository.findGoogleIdentityByProviderId.mockImplementation(async () => {
        if (failurePoint === "provider lookup") throw new Error("private provider detail");
        return null;
      });
      dependencies.identityRepository.findGoogleIdentityByEmail.mockImplementation(async () => {
        if (failurePoint === "email lookup") throw new Error("private email detail");
        return null;
      });
      dependencies.hashProviderId.mockImplementation(async () => {
        if (failurePoint === "hash") throw new Error("private hash detail");
        return "obvious-fake-hash";
      });
      dependencies.identityRepository.createGoogleIdentity.mockImplementation(async () => {
        if (failurePoint === "create") throw new Error("private create detail");
        throw new Error("unexpected create call");
      });
      const provision = createGoogleAccountProvisioner(dependencies);

      await expect(provision(PROFILE)).rejects.toMatchObject({
        code: "GOOGLE_ACCOUNT_PROVISIONING_FAILED",
        message: "Google account provisioning failed.",
      });
    },
  );
});
