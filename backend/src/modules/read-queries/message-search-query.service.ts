import { assertChatMember } from "../../services/authorization.service.js";
import { createGroupMessageSearcher } from "./application/search-group-messages.js";
import { prismaMessageReadRepository } from "./infrastructure/prisma-message-read.repository.js";

export const searchGroupMessagesQuery = createGroupMessageSearcher({
  repository: prismaMessageReadRepository,
  authorizeChat: assertChatMember,
});
