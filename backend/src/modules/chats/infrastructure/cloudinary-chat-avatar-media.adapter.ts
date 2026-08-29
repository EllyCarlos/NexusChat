import {
  deleteFilesFromCloudinary,
  uploadFilesToCloudinary,
} from "../../../utils/auth.util.js";
import type { ChatAvatarMediaPort } from "../contracts/chat-avatar-media.port.js";

export const createCloudinaryChatAvatarMediaAdapter = (
  file: Express.Multer.File,
): ChatAvatarMediaPort => ({
  uploadAvatar: async () => {
    const [uploadedAvatar] = await uploadFilesToCloudinary({ files: [file] });
    return uploadedAvatar
      ? {
          publicId: uploadedAvatar.public_id,
          secureUrl: uploadedAvatar.secure_url,
        }
      : undefined;
  },

  deleteAvatar: (publicId) => deleteFilesFromCloudinary({
    publicIds: [publicId],
  }),
});
