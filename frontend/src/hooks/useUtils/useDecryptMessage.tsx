import { decryptMessage } from "@/lib/client/encryption";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { getOtherMemberOfPrivateChat } from "@/lib/shared/helpers";
import { useCallback, useEffect, useState } from "react";
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
  const [sharedKey, setSharedKey] = useState<CryptoKey>();
  const [decryptedMessage, setDecryptedMessage] = useState<string>("");

  const { getSharedKey } = useGetSharedKey();

  const otherMember = getOtherMemberOfPrivateChat(
    selectedChatDetails,
    loggedInUserId
  ).user;

  const handleSetSharedKey = useCallback(async()=>{
    const key = await getSharedKey({ loggedInUserId, otherMember });
    if (key) setSharedKey(key);
  },[getSharedKey, loggedInUserId, otherMember])

  const handleDecryptMessage = async (
    sharedKey: CryptoKey,
    encryptedMessage: string
  ) => {
    const message = await decryptMessage(sharedKey, encryptedMessage);
    if (message) {
      setDecryptedMessage(message);
    }
  };

  useEffect(() => {
    if (!selectedChatDetails.isGroupChat && cipherText && cipherText.length) {
      handleSetSharedKey();
    } else {
      setDecryptedMessage(cipherText);
    }
  }, [cipherText, handleSetSharedKey, selectedChatDetails.isGroupChat]);

  useEffect(() => {
    if (sharedKey) {
      handleDecryptMessage(sharedKey, cipherText);
    }
  }, [cipherText, sharedKey]);

  return { decryptedMessage };
};
