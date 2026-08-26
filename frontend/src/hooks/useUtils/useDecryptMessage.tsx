import { decryptMessage } from "@/lib/client/encryption";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { getOtherMemberOfPrivateChat } from "@/lib/shared/helpers";
import { useEffect, useState } from "react";
import { useGetSharedKey } from "../useAuth/useGetSharedKey";

type PropTypes = {
  cipherText: string;
  loggedInUserId: string;
  selectedChatDetails: fetchUserChatsResponse;
};

export const useDecryptMessage = ({
  loggedInUserId,
  selectedChatDetails,
  cipherText,
}: PropTypes) => {
  const [decryptedMessage, setDecryptedMessage] = useState<string>("");

  const { getSharedKey } = useGetSharedKey();

  const otherMember = getOtherMemberOfPrivateChat(
    selectedChatDetails,
    loggedInUserId
  ).user;

  useEffect(() => {
    if (selectedChatDetails.isGroupChat || !cipherText) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const sharedKey = await getSharedKey({ loggedInUserId, otherMember });
      if (!sharedKey) return;

      const message = await decryptMessage(sharedKey, cipherText);
      if (!cancelled && message) {
        setDecryptedMessage(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cipherText, getSharedKey, loggedInUserId, otherMember, selectedChatDetails.isGroupChat]);

  return {
    decryptedMessage:
      selectedChatDetails.isGroupChat || !cipherText ? cipherText : decryptedMessage,
  };
};
