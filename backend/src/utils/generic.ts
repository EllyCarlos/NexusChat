import { Message } from "firebase-admin/messaging";
import { getFirebaseMessaging } from "../config/firebase.config.js";
import { notificationTitles } from "../constants/notification-title.contant.js";
import { logServerError } from "./safe-logger.utils.js";


export const calculateSkip  = (page:number,limit:number)=>{
    return Math.ceil((page - 1) * limit)
}

export const getRandomIndex=(length: number): number =>{
    return Math.floor(Math.random() * length);
}

export const sendPushNotification = ({fcmToken,body,title}:{fcmToken:string,body:string,title?:string})=>{
    try {
        console.log('Push notification requested.');
        const link = '/';
        const payload: Message = {
            token:fcmToken,
            notification: {
              title:title?title:`${notificationTitles[getRandomIndex(notificationTitles.length)]}`,
              body,
              imageUrl:"https://res.cloudinary.com/dhdo2yb0w/image/upload/t_media_lib_thumb/logo192_hwepne.png",
            },
            webpush: link && {
              fcmOptions: {
                link,
              },
            },
          };
        void getFirebaseMessaging().send(payload).catch((error) => {
          logServerError("FCM send failed.", error);
        });
    }
    catch (error) {
        logServerError("FCM send failed.", error);
    }
}

export const convertBufferToBase64 = (buffer: Uint8Array<ArrayBuffer>): string => {
  return Buffer.from(buffer).toString("base64");
};

export const bufferToBase64 = (buffer: Buffer): string => {
  return buffer.toString("base64");
};




