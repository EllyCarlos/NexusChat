import { useSendAttachmentsMutation } from "@/lib/client/rtk-query/attachment.api";
import { useToast } from "../useUI/useToast";

export const useSendAttachments = () => {
  const [
    uploadAttachment,
    { error, isError, isLoading, isSuccess, isUninitialized },
  ] = useSendAttachmentsMutation();
  useToast({
    error,
    isError,
    isLoading,
    isSuccess,
    isUninitialized,
    successMessage: "Attachment sent",
    successToast: true,
    loaderToast:true,
    errorToast:true,
    loadingMessage:"Uploading attachment"
  });

  return { uploadAttachment };
};
