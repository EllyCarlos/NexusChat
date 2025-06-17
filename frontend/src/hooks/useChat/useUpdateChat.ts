import { useUpdateChatMutation } from "@/lib/client/rtk-query/chat.api";
import { useToast } from "../useUI/useToast";

export const useUpdateChat = () => {

  const [updateChat,{ error, isError, isLoading, isSuccess, isUninitialized }] = useUpdateChatMutation();
  useToast({error,isError,isLoading,isSuccess,isUninitialized,loaderToast: true,successMessage: "Chat details updated",successToast: true});

  return {
    updateChat,
  };
};
