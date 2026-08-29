import type { ChatAvatarUpload } from "./chat.types.js";

export interface ChatAvatarMediaPort {
  uploadAvatar(): Promise<ChatAvatarUpload | undefined>;
  deleteAvatar(publicId: string): Promise<void>;
}
