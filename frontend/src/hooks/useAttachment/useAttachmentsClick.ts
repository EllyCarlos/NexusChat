import { Message } from "@/interfaces/message.interface";
import { setAttachments } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";

type PropTypes = {
  attachments: Message['attachments']
};

export const useAttachmentsClick = ({ attachments }: PropTypes) => {
  
  const disptach = useAppDispatch();

  const handleAttachmentsClick = () => {
    disptach(setAttachments(attachments));
  };

  return { handleAttachmentsClick };
};
