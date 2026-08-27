import bcrypt from "bcryptjs";
import { DEFAULT_AVATAR } from "../../constants/file.constant.js";
import { createGoogleAccountProvisioner } from "./application/provision-google-account.js";
import { prismaAuthIdentityRepository } from "./infrastructure/prisma-auth-identity.repository.js";

export const provisionGoogleAccount = createGoogleAccountProvisioner({
  identityRepository: prismaAuthIdentityRepository,
  hashProviderId: bcrypt.hash,
  defaultAvatar: DEFAULT_AVATAR,
});
