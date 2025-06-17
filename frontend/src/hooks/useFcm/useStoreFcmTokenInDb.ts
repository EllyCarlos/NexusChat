import { storeFcmToken, updateUserNotificationStatus } from "@/actions/user.actions";
import { startTransition, useActionState, useEffect } from "react";
import toast from "react-hot-toast";

type PropTypes = {
    generatedFcmToken:string | null | undefined,
    userFcmToken:string | null | undefined,
    loggedInUserId:string,
}

export const useStoreFcmTokenInDb = ({generatedFcmToken,userFcmToken,loggedInUserId}:PropTypes) => {

    const [state,storeFcmTokenAction] = useActionState(storeFcmToken,undefined);
    const [notificationStateRes,updateUserNotificationStatusAction] = useActionState(updateUserNotificationStatus,undefined);

    useEffect(()=>{
        if(generatedFcmToken && userFcmToken !== generatedFcmToken){
            startTransition(()=>{
                storeFcmTokenAction({fcmToken:generatedFcmToken,loggedInUserId});
                updateUserNotificationStatusAction({loggedInUserId,notificationStatus:true});
            })
        }
    },[generatedFcmToken, loggedInUserId, userFcmToken])

    useEffect(()=>{
        if(state?.errors.message?.length){
            toast.error("some error occured while storing fcm token");
            console.log("error storing fcm token",state.errors);
        }
    },[state])

    useEffect(()=>{
        if(notificationStateRes?.errors.message?.length) toast.error(notificationStateRes.errors.message);
        else if(notificationStateRes?.success.message?.length) toast.success(notificationStateRes.success.message);
    },[notificationStateRes])

}
