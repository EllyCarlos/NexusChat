import type {
  AvatarUploadSource,
  UploadedAvatar,
} from "./user-profile.js";

export interface AvatarMediaProvider {
  uploadAvatar(source: AvatarUploadSource): Promise<UploadedAvatar>;
  deleteAvatar(publicId: string): Promise<void>;
}
