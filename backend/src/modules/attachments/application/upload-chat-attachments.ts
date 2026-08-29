import { CustomError } from "../../../errors/application-error.js";
import { logServerError } from "../../../utils/safe-logger.utils.js";
import type { AttachmentMediaPort } from "../contracts/attachment-media.port.js";
import type { AttachmentRealtimePort } from "../contracts/attachment-realtime.port.js";
import type { AttachmentRepository } from "../contracts/attachment.repository.js";
import type { AttachmentUnreadMessagePayload } from "../contracts/attachment.types.js";

type UploadChatAttachmentsDependencies = {
  media: AttachmentMediaPort;
  repository: AttachmentRepository;
  realtime: AttachmentRealtimePort;
};

export interface UploadChatAttachmentsInput {
  actorId: string;
  chatId: string;
  memberIds: string[];
  expectedUploadCount: number;
}

export const createChatAttachmentUploader = ({
  media,
  repository,
  realtime,
}: UploadChatAttachmentsDependencies) => async ({
  actorId,
  chatId,
  memberIds,
  expectedUploadCount,
}: UploadChatAttachmentsInput): Promise<void> => {
  let uploadedAttachments: Awaited<ReturnType<AttachmentMediaPort["uploadAttachments"]>> = [];
  let attachmentsCommitted = false;

  try {
    uploadedAttachments = await media.uploadAttachments();

    if (uploadedAttachments.length !== expectedUploadCount) {
      throw new Error("Cloudinary returned incomplete attachment results");
    }

    const newMessage = await repository.createAttachmentMessage({
      actorId,
      chatId,
      attachments: uploadedAttachments,
    });
    attachmentsCommitted = true;

    realtime.emitMessage(chatId, newMessage);

    const otherMemberIds = memberIds.filter((userId) => userId !== actorId);
    const unreadWrites = otherMemberIds.map((userId) =>
      repository.upsertUnreadMessage({
        actorId,
        chatId,
        messageId: newMessage.id,
        userId,
      }));

    await Promise.all(unreadWrites);

    const unreadMessagePayload: AttachmentUnreadMessagePayload = {
      chatId,
      message: {
        attachments: newMessage.attachments.length ? true : false,
        createdAt: newMessage.createdAt,
      },
      sender: {
        id: newMessage.sender.id,
        avatar: newMessage.sender.avatar,
        username: newMessage.sender.avatar,
      },
    };

    realtime.emitUnreadMessage(chatId, unreadMessagePayload);
  } catch (error) {
    if (!attachmentsCommitted && uploadedAttachments.length) {
      try {
        await media.deleteAttachments(
          uploadedAttachments.map(({ publicId }) => publicId),
        );
      } catch (cleanupError) {
        logServerError("New attachment rollback failed.", cleanupError);
      }
    }

    throw error instanceof CustomError
      ? error
      : new CustomError("Failed to upload attachments", 500);
  }
};
