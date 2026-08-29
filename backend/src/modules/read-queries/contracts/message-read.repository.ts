import type {
  MessageReadView,
  ReadRepositoryPageInput,
} from "./read-query.types.js";

export interface MessageReadRepository {
  listMessages(input: ReadRepositoryPageInput): Promise<MessageReadView[]>;
  countMessages(chatId: string): Promise<number>;
}
