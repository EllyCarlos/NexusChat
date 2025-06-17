import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useSendMessage } from "./useSendMessage";
import { selectReplyingToMessageData, setReplyingToMessageData, setReplyingToMessageId } from "@/lib/client/slices/uiSlice";

type PropTypes = {
  messageVal: string;
  setMessageVal: React.Dispatch<React.SetStateAction<string>>;
};

export const useHandleSendMessage = ({
  messageVal,
  setMessageVal,
}: PropTypes) => {
  const { sendMessage } = useSendMessage();

  const data =  useAppSelector(selectReplyingToMessageData);
  const dispatch = useAppDispatch();

  const handleMessageSubmit = (e: React.FormEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (messageVal.trim().length) {
      sendMessage(messageVal);
      if(data){
        dispatch(setReplyingToMessageData(null));
        dispatch(setReplyingToMessageId(null));
      }
    }
    setMessageVal("");
  };

  return { handleMessageSubmit };
};
