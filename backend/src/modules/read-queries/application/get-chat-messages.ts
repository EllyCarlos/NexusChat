import type { MessageReadRepository } from "../contracts/message-read.repository.js";
import type {
  MessagePageView,
  ReadPageInput,
} from "../contracts/read-query.types.js";
import { calculateReadSkip } from "./read-pagination.js";

export const createChatMessageReader = ({
  repository,
}: {
  repository: MessageReadRepository;
}) => async ({
  chatId,
  page = 1,
  limit = 20,
}: ReadPageInput): Promise<MessagePageView> => {
  const pageNumber = Number(page);
  const limitNumber = Number(limit);
  const messages = await repository.listMessages({
    chatId,
    skip: calculateReadSkip(pageNumber, limitNumber),
    take: limitNumber,
  });
  const totalMessagesCount = await repository.countMessages(chatId);

  return {
    messages: messages.reverse(),
    totalPages: Math.ceil(totalMessagesCount / limitNumber),
  };
};
