import type {
  MessageReadView,
  MessageSearchRecord,
  ReadGroupMessageSearchRepositoryInput,
  ReadMessageByIdInput,
  ReadMessageContextSideInput,
  ReadRepositoryPageInput,
} from "./read-query.types.js";

export interface MessageReadRepository {
  listMessages(input: ReadRepositoryPageInput): Promise<MessageReadView[]>;
  countMessages(chatId: string): Promise<number>;
  findMessage(input: ReadMessageByIdInput): Promise<MessageReadView | null>;
  listMessagesBefore(input: ReadMessageContextSideInput): Promise<MessageReadView[]>;
  listMessagesAfter(input: ReadMessageContextSideInput): Promise<MessageReadView[]>;
  searchGroupMessages(input: ReadGroupMessageSearchRepositoryInput): Promise<MessageSearchRecord[]>;
}
