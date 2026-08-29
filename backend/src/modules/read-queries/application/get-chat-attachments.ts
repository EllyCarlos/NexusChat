import type { AttachmentReadRepository } from "../contracts/attachment-read.repository.js";
import type {
  AttachmentPageView,
  ReadPageInput,
} from "../contracts/read-query.types.js";
import { calculateReadSkip } from "./read-pagination.js";

export const createChatAttachmentReader = ({
  repository,
}: {
  repository: AttachmentReadRepository;
}) => async ({
  chatId,
  page = 1,
  limit = 6,
}: ReadPageInput): Promise<AttachmentPageView> => {
  const pageNumber = Number(page);
  const limitNumber = Number(limit);
  const attachments = await repository.listAttachments({
    chatId,
    skip: calculateReadSkip(pageNumber, limitNumber),
    take: limitNumber,
  });
  const totalAttachmentsCount = await repository.countAttachments(chatId);

  return {
    attachments,
    totalAttachmentsCount,
    totalPages: Math.ceil(totalAttachmentsCount / limitNumber),
  };
};
