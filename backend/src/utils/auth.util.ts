// Add this import at the top of auth.util.ts
import { Prisma } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import { convertBufferToBase64 } from './generic.js';


const thirtyDaysInMilliseconds = 30 * 24 * 60 * 60 * 1000;

// const cookieOptions:CookieOptions = {
//     maxAge:thirtyDaysInMilliseconds,
//     httpOnly:true,
//     path:"/",
//     priority:"high",
//     secure:true,
//     sameSite:env.NODE_ENV==='DEVELOPMENT'?"lax":"none",
//     domain: env.NODE_ENV === 'DEVELOPMENT' ? 'localhost' : 'aesehi.online',
//     partitioned:true,
// }

export const uploadFilesToCloudinary = async({files}:{files:Express.Multer.File[]})=>{
    try {
        const uploadPromises = files.map(file=>cloudinary.uploader.upload(file.path))
        const result = await Promise.all(uploadPromises)
        return result
    } catch (error) {
        console.log('Error uploading files to cloudinary');
        console.log(error);
    }
}

export const deleteFilesFromCloudinary = async({publicIds}:{publicIds:string[]}):Promise<any[] | undefined>=>{
    try {
        await cloudinary.uploader.destroy(publicIds[0])
        const deletePromises = publicIds.map(publicId=>cloudinary.uploader.destroy(publicId))
        const uploadResult = await Promise.all(deletePromises)
        return uploadResult
    } catch (error) {
        console.log('Error deleting files from cloudinary');
        console.log(error);
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
      console.error("Error uploading encrypted audio to Cloudinary:", error);
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
      console.error("Error uploading audio to Cloudinary:", error);
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