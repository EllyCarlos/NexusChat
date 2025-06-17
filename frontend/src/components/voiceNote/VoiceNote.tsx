import { useGetSharedKey } from "@/hooks/useAuth/useGetSharedKey";
import { decryptAudioBlob } from "@/lib/client/encryption";
import { setNewMessageFormed } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { getOtherMemberOfPrivateChat } from "@/lib/shared/helpers";
import { useCallback, useEffect, useState } from "react";

type PropTypes = {
    audioUrl:string;
    loggedInUserId: string;
    selectedChatDetails: fetchUserChatsResponse;
}

export const VoiceNote = ({audioUrl,loggedInUserId,selectedChatDetails}:PropTypes) => {

    const [base64Audio, setBase64Audio] = useState<Uint8Array<ArrayBuffer> | null>(null);
    const {getSharedKey} = useGetSharedKey();

    const [sharedKey, setSharedKey] = useState<CryptoKey>();
    const [url,setUrl] = useState<string | null>(null);

    const dispatch = useAppDispatch();

    const fetchAudioAsBuffer = useCallback(async (audioUrl: string) => {
        try {
          const response = await fetch(audioUrl);
          const arrayBuffer = await response.arrayBuffer(); // Fetch as binary
          setBase64Audio(new Uint8Array(arrayBuffer));
        } catch (error) {
          console.error("Error fetching encrypted audio:", error);
          return null;
        }
    },[]);

    const otherMember =  getOtherMemberOfPrivateChat(selectedChatDetails,loggedInUserId).user;
    
    const setSharedKeyInState = useCallback(async()=>{
        const sharedKey = await getSharedKey({loggedInUserId,otherMember});
        setSharedKey(sharedKey);
    },[getSharedKey, loggedInUserId, otherMember]);
    
    const handleSetDecryptAudio = useCallback(async({encryptedAudio,sharedKey}:{sharedKey:CryptoKey,encryptedAudio:Uint8Array<ArrayBuffer>})=>{
        const blob =  await decryptAudioBlob({sharedKey,encryptedAudio});
        if(blob) setUrl(URL.createObjectURL(blob));
    },[])

    useEffect(()=>{
        fetchAudioAsBuffer(audioUrl);
        if(!selectedChatDetails.isGroupChat){
            // as because group chats audio are not encrypted
            setSharedKeyInState();
        }
    },[])

    useEffect(()=>{
        if(base64Audio && sharedKey){
            handleSetDecryptAudio({encryptedAudio:base64Audio,sharedKey})
        }
        else if(base64Audio && selectedChatDetails.isGroupChat){
            const blob = new Blob([base64Audio], { type: "audio/webm" });
            setUrl(URL.createObjectURL(blob));
        }
    },[base64Audio,sharedKey])

    useEffect(()=>{
        if(url){
            dispatch(setNewMessageFormed(true));
        }
    },[url])
      

  return (
    url && (
        <audio src={url} className="max-sm:w-56 max-sm:h-[40px]" controls></audio>
    )   
  )
}
