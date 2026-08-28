import type {
  AttachmentMessageView,
  AttachmentUpload,
} from "./attachment.types.js";

export interface CreateAttachmentMessageInput {
  actorId: string;
  chatId: string;
  attachments: AttachmentUpload[];
}

export interface UpsertUnreadMessageInput {
  actorId: string;
  chatId: string;
  messageId: string;
  userId: string;
}

export interface AttachmentRepository {
  createAttachmentMessage(
    input: CreateAttachmentMessageInput,
  ): Promise<AttachmentMessageView>;
  upsertUnreadMessage(input: UpsertUnreadMessageInput): Promise<void>;
}
