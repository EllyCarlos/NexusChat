import {
  deleteFilesFromCloudinary,
  uploadFilesToCloudinary,
} from "../../../utils/auth.util.js";
import type { AttachmentMediaPort } from "../contracts/attachment-media.port.js";

export const createCloudinaryAttachmentMediaAdapter = (
  files: Express.Multer.File[],
): AttachmentMediaPort => ({
  uploadAttachments: async () => {
    const uploadedAttachments = await uploadFilesToCloudinary({ files });
    return uploadedAttachments.map(({ public_id, secure_url }) => ({
      publicId: public_id,
      secureUrl: secure_url,
    }));
  },

  deleteAttachments: (publicIds) => deleteFilesFromCloudinary({ publicIds }),
});
