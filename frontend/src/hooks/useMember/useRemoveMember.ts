import { useRemoveMemberMutation } from "@/lib/client/rtk-query/chat.api";
import { useToast } from "../useUI/useToast";

export const useRemoveMember = () => {

  const [removeMember,{ isError, isLoading, isSuccess, isUninitialized, error }] = useRemoveMemberMutation();
  useToast({error,isError,isLoading,isSuccess,isUninitialized,loaderToast: true,successToast: true,errorToast: true,successMessage: "Member removed"});

  return {removeMember};
};
