import { Buffer } from "node:buffer";
import { z } from "zod";
import type { AuthorizedChat } from "../../../services/authorization.service.js";
import { CustomError } from "../../../utils/error.utils.js";
import type { MessageReadRepository } from "../contracts/message-read.repository.js";
import type {
  MessageSearchCursor,
  MessageSearchResultView,
  MessageSearchView,
  ReadGroupMessageSearchInput,
} from "../contracts/read-query.types.js";

const MESSAGE_SEARCH_CURSOR_VERSION = 1;
const INVALID_SEARCH_CURSOR_MESSAGE = "Invalid search cursor";
const OPAQUE_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

const cursorPayloadSchema = z.object({
  v: z.literal(MESSAGE_SEARCH_CURSOR_VERSION),
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().cuid(),
}).strict();

type AuthorizeChat = (
  actorUserId: string,
  chatId: string,
) => Promise<AuthorizedChat>;

const invalidSearchCursor = () => new CustomError(INVALID_SEARCH_CURSOR_MESSAGE, 400);

export const escapeMessageSearchPattern = (query: string): string =>
  query.replace(/[\\%_]/g, "\\$&");

export const encodeMessageSearchCursor = ({
  createdAt,
  id,
}: MessageSearchCursor): string => Buffer.from(JSON.stringify({
  v: MESSAGE_SEARCH_CURSOR_VERSION,
  createdAt: createdAt.toISOString(),
  id,
}), "utf8").toString("base64url");

export const decodeMessageSearchCursor = (cursor: string): MessageSearchCursor => {
  try {
    if (!OPAQUE_CURSOR_PATTERN.test(cursor)) throw invalidSearchCursor();

    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== cursor) {
      throw invalidSearchCursor();
    }

    const payload = cursorPayloadSchema.parse(JSON.parse(decoded));
    const createdAt = new Date(payload.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw invalidSearchCursor();

    return { createdAt, id: payload.id };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw invalidSearchCursor();
  }
};

export const createGroupMessageSearcher = ({
  repository,
  authorizeChat,
}: {
  repository: MessageReadRepository;
  authorizeChat: AuthorizeChat;
}) => async ({
  actorUserId,
  chatId,
  q,
  limit,
  cursor,
}: ReadGroupMessageSearchInput): Promise<MessageSearchView> => {
  const chat = await authorizeChat(actorUserId, chatId);
  if (chat.isGroupChat !== true) {
    throw new CustomError("Chat not found", 404);
  }

  const rows = await repository.searchGroupMessages({
    actorUserId,
    chatId,
    escapedQuery: escapeMessageSearchPattern(q),
    ...(cursor ? { cursor: decodeMessageSearchCursor(cursor) } : {}),
    take: limit + 1,
  });

  if (rows.some((message) => (
    message.chatId !== chatId
    || typeof message.textMessageContent !== "string"
  ))) {
    throw new CustomError("Chat not found", 404);
  }

  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit) as MessageSearchResultView[];
  const finalMessage = messages[messages.length - 1];

  return {
    messages,
    nextCursor: hasMore && finalMessage
      ? encodeMessageSearchCursor(finalMessage)
      : null,
    hasMore,
  };
};
