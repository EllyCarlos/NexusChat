// Add this import at the top of auth.util.ts
import { Prisma } from '@prisma/client';
import type { UploadApiResponse } from 'cloudinary';
import { v2 as cloudinary } from 'cloudinary';
import { convertBufferToBase64 } from './generic.js';
import { logServerError } from './safe-logger.utils.js';


const thirtyDaysInMilliseconds = 30 * 24 * 60 * 60 * 1000;

// const cookieOptions:CookieOptions = {
//     maxAge:thirtyDaysInMilliseconds,
//     httpOnly:true,
//     path:"/",
//     priority:"high",
//     secure:true,
//     sameSite:env.NODE_ENV==='development'?"lax":"none",
//     domain: env.NODE_ENV === 'development' ? 'localhost',
//     partitioned:true,
// }

export const deleteFilesFromCloudinary = async ({
    publicIds,
    resourceType = 'image',
}: {
    publicIds: string[];
    resourceType?: 'image' | 'raw' | 'video';
}): Promise<void> => {
    const uniquePublicIds = [...new Set(publicIds.filter(Boolean))]
    const results = await Promise.allSettled(
      uniquePublicIds.map(publicId => cloudinary.uploader.destroy(publicId, { resource_type: resourceType }))
    )

    for (const result of results) {
      if (result.status === 'rejected') {
        logServerError('Cloudinary file deletion failed.', result.reason)
      }
    }
}

export const uploadFilesToCloudinary = async ({ files }: { files: Express.Multer.File[] }): Promise<UploadApiResponse[]> => {
    const uploadedFiles: UploadApiResponse[] = []
    try {
      for (const file of files) {
        uploadedFiles.push(await cloudinary.uploader.upload(file.path))
      }
      return uploadedFiles
    } catch (error) {
      await deleteFilesFromCloudinary({
        publicIds: uploadedFiles.map(file => file.public_id)
      })
      logServerError('Cloudinary file upload failed.', error)
      throw error
    }
}

export const uploadEncryptedAudioToCloudinary = async ({buffer}: {buffer: Uint8Array<ArrayBuffer>}): Promise<any | undefined> => {
    try {
      const base64Audio = `data:audio/webm;base64,${convertBufferToBase64(buffer)}`; // Adjust MIME type if needed
      const uploadResult = await cloudinary.uploader.upload(base64Audio, {
        resource_type: "raw", // "raw" for non-standard formats (or "video" for MP4)
        folder: "encrypted-audio",
      });
      return uploadResult;
    } catch (error) {
      logServerError("Cloudinary encrypted-audio upload failed.", error);
    }
};

export const uploadAudioToCloudinary = async ({buffer}: {buffer: Uint8Array<ArrayBuffer>}): Promise<any | undefined> => {
    try {
      const base64Audio = `data:audio/webm;base64,${convertBufferToBase64(buffer)}`; // Adjust MIME type if needed
      const uploadResult = await cloudinary.uploader.upload(base64Audio, {
        resource_type: "raw", // "raw" for non-standard formats (or "video" for MP4)
        folder: "group-audio",
      });
      return uploadResult;
    } catch (error) {
      logServerError("Cloudinary audio upload failed.", error);
    }
};

export const getSecureUserInfo = (user: Prisma.UserGetPayload<{
    select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        email: true,
        createdAt: true,
        updatedAt: true,
        verified: true,
        publicKey: true,
        notificationsEnabled: true,
        verificationBadge: true,
        fcmToken: true,
        oAuthSignup: true
    }
}>): any => {
    return {
        id: user.id,
        name: user.name,
        username: user.username,
        avatar: user.avatar, // Now properly typed
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        verified: user.verified, // Now properly typed
        publicKey: user?.publicKey,
        notificationsEnabled: user.notificationsEnabled,
        verificationBadge: user.verificationBadge,
        fcmTokenExists: user.fcmToken?.length ? true : false, // Now properly typed
        oAuthSignup: user.oAuthSignup
    }
}
