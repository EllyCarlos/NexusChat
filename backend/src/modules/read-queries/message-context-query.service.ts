import { assertMessageAccessible } from "../../services/authorization.service.js";
import { createMessageContextReader } from "./application/get-message-context.js";
import { prismaMessageReadRepository } from "./infrastructure/prisma-message-read.repository.js";

export const getMessageContextQuery = createMessageContextReader({
  repository: prismaMessageReadRepository,
  authorizeMessage: assertMessageAccessible,
});
