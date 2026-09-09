import type { AuthorizedMessage } from "../../../services/authorization.service.js";
import { CustomError } from "../../../utils/error.utils.js";
import type { MessageReadRepository } from "../contracts/message-read.repository.js";
import type {
  MessageContextView,
  ReadMessageContextInput,
} from "../contracts/read-query.types.js";

type AuthorizeMessage = (
  actorUserId: string,
  chatId: string,
  messageId: string,
) => Promise<AuthorizedMessage>;

export const createMessageContextReader = ({
  repository,
  authorizeMessage,
}: {
  repository: MessageReadRepository;
  authorizeMessage: AuthorizeMessage;
}) => async ({
  actorUserId,
  chatId,
  messageId,
  before,
  after,
}: ReadMessageContextInput): Promise<MessageContextView> => {
  const authorizedAnchor = await authorizeMessage(actorUserId, chatId, messageId);
  const anchor = await repository.findMessage({
    actorUserId,
    chatId,
    messageId: authorizedAnchor.id,
  });

  if (!anchor || anchor.chatId !== chatId) {
    throw new CustomError("Message not found", 404);
  }

  const [beforeRows, afterRows] = await Promise.all([
    repository.listMessagesBefore({
      actorUserId,
      chatId,
      messageId: anchor.id,
      anchorCreatedAt: anchor.createdAt,
      take: before + 1,
    }),
    repository.listMessagesAfter({
      actorUserId,
      chatId,
      messageId: anchor.id,
      anchorCreatedAt: anchor.createdAt,
      take: after + 1,
    }),
  ]);

  if ([...beforeRows, ...afterRows].some((message) => message.chatId !== chatId)) {
    throw new CustomError("Message not found", 404);
  }

  return {
    anchorMessageId: anchor.id,
    messages: [
      ...beforeRows.slice(0, before).reverse(),
      anchor,
      ...afterRows.slice(0, after),
    ],
    hasMoreBefore: beforeRows.length > before,
    hasMoreAfter: afterRows.length > after,
  };
};
