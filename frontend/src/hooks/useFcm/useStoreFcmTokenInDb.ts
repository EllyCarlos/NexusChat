import { storeFcmToken, updateUserNotificationStatus } from "@/actions/user.actions";
import { startTransition, useActionState, useEffect } from "react";
import toast from "react-hot-toast";

type PropTypes = {
    generatedFcmToken:string | null | undefined,
    userFcmToken:string | null | undefined,
}

export const useStoreFcmTokenInDb = ({generatedFcmToken,userFcmToken}:PropTypes) => {

    const [state,storeFcmTokenAction] = useActionState(storeFcmToken,undefined);
    const [notificationStateRes,updateUserNotificationStatusAction] = useActionState(updateUserNotificationStatus,undefined);

    useEffect(()=>{
        if(generatedFcmToken && userFcmToken !== generatedFcmToken){
            startTransition(()=>{
                storeFcmTokenAction({fcmToken:generatedFcmToken});
                updateUserNotificationStatusAction({notificationStatus:true});
            })
        }
    },[generatedFcmToken, userFcmToken])

    useEffect(()=>{
        if(state?.errors.message?.length){
            toast.error("some error occured while storing fcm token");
        }
    },[state])

    useEffect(()=>{
        if(notificationStateRes?.errors.message?.length) toast.error(notificationStateRes.errors.message);
        else if(notificationStateRes?.success.message?.length) toast.success(notificationStateRes.success.message);
    },[notificationStateRes])

}
