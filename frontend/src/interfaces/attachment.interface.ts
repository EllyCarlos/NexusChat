// src/interfaces/attachment.interface.ts
export interface SingleAttachment {
  id: string;
  secureUrl: string;
  cloudinaryPublicId: string;
}

export interface AttachmentResponse {
  attachments: SingleAttachment[];
  totalAttachmentsCount: number;
  totalPages: number;
}
