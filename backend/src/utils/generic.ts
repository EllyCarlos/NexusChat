import {
  sendPushNotification as sendPushNotificationThroughProvider,
} from "../modules/notifications/push-notification.service.js";


export const calculateSkip  = (page:number,limit:number)=>{
    return Math.ceil((page - 1) * limit)
}

export const getRandomIndex=(length: number): number =>{
    return Math.floor(Math.random() * length);
}

export const sendPushNotification = ({
  fcmToken,
  body,
  title,
}: {
  fcmToken: string;
  body: string;
  title?: string;
}): void => {
  sendPushNotificationThroughProvider({
    recipientToken: fcmToken,
    body,
    title,
  });
};

export const convertBufferToBase64 = (buffer: Uint8Array<ArrayBuffer>): string => {
  return Buffer.from(buffer).toString("base64");
};

export const bufferToBase64 = (buffer: Buffer): string => {
  return buffer.toString("base64");
};




