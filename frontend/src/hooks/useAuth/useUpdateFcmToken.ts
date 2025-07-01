import { useEffect } from "react";
import { useToast } from "../useUI/useToast";
// import { updateLoggedInUserFcmTokenStatus } from "../../services/redux/slices/authSlice"
import { useUpdateFcmTokenMutation } from "@/lib/client/rtk-query/auth.api";

export const useUpdateFcmToken = () => {


  const [
    updateFcmToken,
    { error, isError, isLoading, isSuccess, isUninitialized, data },
  ] = useUpdateFcmTokenMutation();
  useToast({
    error,
    isError,
    isLoading,
    isSuccess,
    isUninitialized,
    successMessage: "Great! now you will receive notifications from NexusChat",
    successToast: true,
  });

  useEffect(() => {
    // if(isSuccess && data) //dispatch(updateLoggedInUserFcmTokenStatus(data.fcmTokenExists))
  }, [isSuccess, data]);

  return {
    updateFcmToken,
    isSuccess,
  };
};
