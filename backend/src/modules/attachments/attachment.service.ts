import {
  createChatAttachmentUploader,
} from "./application/upload-chat-attachments.js";
import { createCloudinaryAttachmentMediaAdapter } from "./infrastructure/cloudinary-attachment-media.adapter.js";
import { prismaAttachmentRepository } from "./infrastructure/prisma-attachment.repository.js";
import {
  createSocketAttachmentRealtimeAdapter,
  type SocketServerResolver,
} from "./infrastructure/socket-attachment-realtime.adapter.js";

type AttachmentUploadComposition = {
  files: Express.Multer.File[];
  resolveSocketServer: SocketServerResolver;
};

export const createUploadChatAttachmentsOperation = ({
  files,
  resolveSocketServer,
}: AttachmentUploadComposition) => createChatAttachmentUploader({
  media: createCloudinaryAttachmentMediaAdapter(files),
  repository: prismaAttachmentRepository,
  realtime: createSocketAttachmentRealtimeAdapter(resolveSocketServer),
});
