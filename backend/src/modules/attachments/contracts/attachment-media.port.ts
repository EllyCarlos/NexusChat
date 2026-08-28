import type { AttachmentUpload } from "./attachment.types.js";

export interface AttachmentMediaPort {
  uploadAttachments(): Promise<AttachmentUpload[]>;
  deleteAttachments(publicIds: string[]): Promise<void>;
}
