import { createSessionAuthenticator } from "./application/authenticate-session.js";
import { prismaAuthIdentityRepository } from "./infrastructure/prisma-auth-identity.repository.js";
import { verifySessionToken } from "./token/session-token.service.js";

export const authenticateSession = createSessionAuthenticator({
  identityRepository: prismaAuthIdentityRepository,
  verifyToken: verifySessionToken,
});
