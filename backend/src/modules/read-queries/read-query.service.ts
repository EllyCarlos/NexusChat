import { createChatAttachmentReader } from "./application/get-chat-attachments.js";
import { createChatMessageReader } from "./application/get-chat-messages.js";
import { createUserChatLister } from "./application/get-user-chats.js";
import { prismaAttachmentReadRepository } from "./infrastructure/prisma-attachment-read.repository.js";
import { prismaChatReadRepository } from "./infrastructure/prisma-chat-read.repository.js";
import { prismaMessageReadRepository } from "./infrastructure/prisma-message-read.repository.js";

export const getUserChatsQuery = createUserChatLister({
  repository: prismaChatReadRepository,
});

export const getChatMessagesQuery = createChatMessageReader({
  repository: prismaMessageReadRepository,
});

export const getChatAttachmentsQuery = createChatAttachmentReader({
  repository: prismaAttachmentReadRepository,
});
