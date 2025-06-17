import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { useSendAttachments } from "./useSendAttachments";

type PropTypes = {
  selectedChatDetails: fetchUserChatsResponse | null;
  selectedAttachments: Blob[];
  setSelectedAttachments: React.Dispatch<React.SetStateAction<Array<Blob>>>;
};

export const useHandleUploadAttachment = ({
  selectedChatDetails,
  selectedAttachments,
  setSelectedAttachments,
}: PropTypes) => {

  const { uploadAttachment} = useSendAttachments();

  const handleUploadAttachments = () => {
    if (selectedChatDetails && selectedAttachments) {
      uploadAttachment({
        attachments: selectedAttachments,
        chatId: selectedChatDetails?.id,
      });
      setSelectedAttachments([]);
    }
  };
  
  return { handleUploadAttachments };
};
