import {
  deleteFilesFromCloudinary,
  uploadFilesToCloudinary,
} from "../../../utils/auth.util.js";
import type { AvatarMediaProvider } from "../contracts/avatar-media.provider.js";

export const cloudinaryAvatarMediaProvider: AvatarMediaProvider = {
  uploadAvatar: async (source) => {
    const [uploadedAvatar] = await uploadFilesToCloudinary({
      files: [{ path: source.path } as Express.Multer.File],
    });
    if (!uploadedAvatar) {
      throw new Error("Avatar upload returned no result");
    }

    return {
      publicId: uploadedAvatar.public_id,
      secureUrl: uploadedAvatar.secure_url,
    };
  },

  deleteAvatar: (publicId) => deleteFilesFromCloudinary({
    publicIds: [publicId],
  }),
};
