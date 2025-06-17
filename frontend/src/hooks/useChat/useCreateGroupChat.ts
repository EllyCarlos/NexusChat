import { useCreateChatMutation } from "@/lib/client/rtk-query/chat.api";
import { useToast } from "../useUI/useToast";

export const useCreateGroupChat = () => {
  const [
    createChat,
    { isLoading, isError, isSuccess, error, isUninitialized },
  ] = useCreateChatMutation();
  useToast({
    isLoading,
    isUninitialized,
    isSuccess,
    isError,
    error,
    successToast: true,
    successMessage: "Group chat created",
  });

  return {
    createChat,
    isSuccess,
    isLoading,
  };
};
