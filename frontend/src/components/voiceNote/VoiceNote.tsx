import { useGetSharedKey } from "@/hooks/useAuth/useGetSharedKey";
import { decryptAudioBlob } from "@/lib/client/encryption";
import { setNewMessageFormed } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import type { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { getOtherMemberOfPrivateChat } from "@/lib/shared/helpers";
import { useEffect, useState } from "react";

type PropTypes = {
    audioUrl:string;
    loggedInUserId: string;
    selectedChatDetails: fetchUserChatsResponse;
}

export const VoiceNote = ({audioUrl,loggedInUserId,selectedChatDetails}:PropTypes) => {

    const {getSharedKey} = useGetSharedKey();
    const [url,setUrl] = useState<string | null>(null);

    const dispatch = useAppDispatch();

    const otherMember = getOtherMemberOfPrivateChat(
      selectedChatDetails,
      loggedInUserId
    ).user;
    const otherMemberId = otherMember.id;
    const otherMemberPublicKey = otherMember.publicKey;

    useEffect(() => {
      let cancelled = false;
      let objectUrl: string | null = null;

      void (async () => {
        try {
          const response = await fetch(audioUrl);
          if (!response.ok) {
            console.error("Failed to load encrypted audio.");
            return;
          }

          const encryptedAudio = new Uint8Array(await response.arrayBuffer());
          let blob: Blob | null;

          if (selectedChatDetails.isGroupChat) {
            blob = new Blob([encryptedAudio], { type: "audio/webm" });
          } else {
            const sharedKey = await getSharedKey({
              loggedInUserId,
              otherMember: {
                id: otherMemberId,
                publicKey: otherMemberPublicKey,
              },
            });
            blob = sharedKey
              ? await decryptAudioBlob({ sharedKey, encryptedAudio })
              : null;
          }

          if (!cancelled && blob) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          }
        } catch {
          console.error("Failed to load encrypted audio.");
        }
      })();

      return () => {
        cancelled = true;
        if (objectUrl) {
          const revokedUrl = objectUrl;
          setUrl((currentUrl) => currentUrl === revokedUrl ? null : currentUrl);
          URL.revokeObjectURL(revokedUrl);
        }
      };
    }, [
      audioUrl,
      getSharedKey,
      loggedInUserId,
      otherMemberId,
      otherMemberPublicKey,
      selectedChatDetails.isGroupChat,
    ]);

    useEffect(()=>{
        if(url){
            dispatch(setNewMessageFormed(true));
        }
    },[dispatch, url])
      

  return (
    url && (
        <audio src={url} className="max-sm:w-56 max-sm:h-[40px]" controls></audio>
    )   
  )
}
