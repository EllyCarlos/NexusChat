import type {
  ReadRepositoryPageInput,
  SecureAttachmentView,
} from "./read-query.types.js";

export interface AttachmentReadRepository {
  listAttachments(input: ReadRepositoryPageInput): Promise<SecureAttachmentView[]>;
  countAttachments(chatId: string): Promise<number>;
}
