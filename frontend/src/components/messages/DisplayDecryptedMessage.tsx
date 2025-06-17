"use client";
import { useDecryptMessage } from "@/hooks/useUtils/useDecryptMessage";
import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";

type PropTypes = {
  cipherText: string;
  chat: fetchUserChatsResponse;
};

export const DisplayDecryptedMessage = ({ cipherText, chat }: PropTypes) => {
  const loggedInUserId = useAppSelector(selectLoggedInUser)?.id as string;

  const { decryptedMessage } = useDecryptMessage({
    cipherText,
    loggedInUserId,
    selectedChatDetails: chat,
  });

  return (
    <>
      {decryptedMessage?.length > 16
        ? decryptedMessage.substring(0, 20) + "..."
        : decryptedMessage}
    </>
  );
};
