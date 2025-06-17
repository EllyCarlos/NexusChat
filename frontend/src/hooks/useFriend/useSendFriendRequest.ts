import { useSendFriendRequestMutation } from "@/lib/client/rtk-query/request.api";
import { useToast } from "../useUI/useToast";

export const useSendFriendRequest = () => {
  const [
    sendFriendRequest,
    { error, isError, isLoading, isSuccess, isUninitialized },
  ] = useSendFriendRequestMutation();

  useToast({
    error,
    isError,
    isLoading,
    isSuccess,
    isUninitialized,
    successMessage: "Friend request sent",
    successToast: true,
    errorToast:true,
  });

  return {
    sendFriendRequest,
  };
};
