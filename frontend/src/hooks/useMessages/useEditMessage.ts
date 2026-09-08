import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";
import { selectLoggedInUser } from "../../lib/client/slices/authSlice";
import { selectSelectedChatDetails } from "../../lib/client/slices/chatSlice";
import { useAppSelector } from "../../lib/client/store/hooks";
import { encryptMessage } from "../../lib/client/encryption";
import { useGetSharedKey } from "../useAuth/useGetSharedKey";
import { getOtherMemberOfPrivateChat } from "@/lib/shared/helpers";
import toast from "react-hot-toast";

type MessageEditEventSendPayload = {
  chatId:string
  messageId:string
  updatedTextContent:string
}

export const useEditMessage = () => {

  const socket = useSocket();
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);
  const loggedInUserId = useAppSelector(selectLoggedInUser)?.id;

  const { getSharedKey } = useGetSharedKey();

  const editMessage = async (messageId: string, updatedContent: string) => {

    if (selectedChatDetails && loggedInUserId) {

      let textContentToEmit = updatedContent;

      if (!selectedChatDetails.isGroupChat) {
        try {
          const otherMember =  getOtherMemberOfPrivateChat(selectedChatDetails,loggedInUserId).user;
          const sharedKey = await getSharedKey({ loggedInUserId, otherMember });

          if (!sharedKey) {
            toast.error("Unable to securely update this message. Please try again.");
            return false;
          }

          const encryptedMessage = await encryptMessage({
            message: updatedContent,
            sharedKey,
          });

          if (!encryptedMessage?.trim() || encryptedMessage === updatedContent) {
            toast.error("Unable to securely update this message. Please try again.");
            return false;
          }
          textContentToEmit = encryptedMessage;
        } catch {
          toast.error("Unable to securely update this message. Please try again.");
          return false;
        }
      }

      const payload:MessageEditEventSendPayload = {
        chatId: selectedChatDetails.id,
        messageId: messageId,
        updatedTextContent: textContentToEmit,
      };

      socket?.emit(Event.MESSAGE_EDIT, payload);
      return true;
    }

    return false;
  };

  return { editMessage };
};
