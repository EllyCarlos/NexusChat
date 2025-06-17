'use client';
import { useGetSharedKey } from "@/hooks/useAuth/useGetSharedKey";
import { useSendMessage } from "@/hooks/useMessages/useSendMessage";
import { useToggleGif } from "@/hooks/useUI/useToggleGif";
import { encryptAudioBlob } from "@/lib/client/encryption";
import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { blobToUint8Array, getOtherMemberOfPrivateChat } from "@/lib/shared/helpers";
import { motion } from "framer-motion";
import { Dispatch, SetStateAction, useCallback, useRef, useState } from "react";
import { AttachmentIcon } from "../ui/icons/AttachmentIcon";
import { DeleteIcon } from "../ui/icons/DeleteIcon";
import { GifIcon } from "../ui/icons/GifIcon";
import { SendIcon } from "../ui/icons/SendIcon";
import { VoiceNoteMicIcon } from "../ui/icons/VoiceNoteMicIcon";
import {} from '@/lib/shared/helpers'
import { setReplyingToMessageData, setReplyingToMessageId } from "@/lib/client/slices/uiSlice";

type PropTypes = {
  toggleAttachmentsMenu: React.Dispatch<React.SetStateAction<boolean>>;
  isRecording: boolean;
  setIsRecording: Dispatch<SetStateAction<boolean>>;
  voiceNoteRecorded: boolean;
  setVoiceNoteRecorded: Dispatch<SetStateAction<boolean>>;
};

export const MessageInputExtraOptions = ({
  toggleAttachmentsMenu,
  isRecording,
  setIsRecording,
  voiceNoteRecorded,
  setVoiceNoteRecorded,
}: PropTypes) => {


  const { toggleGifForm } = useToggleGif();

  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const loggedInUserId = useAppSelector(selectLoggedInUser)?.id as string
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails) as fetchUserChatsResponse;
  const otherMember =  getOtherMemberOfPrivateChat(selectedChatDetails,loggedInUserId);

  const {sendMessage} = useSendMessage();

  const dispatch = useAppDispatch();
 
  const startRecording = async () => {
    try {
      setVoiceNoteRecorded(false);
      setIsRecording(true);
      setAudioURL(null);
      audioChunks.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = "audio/webm; codecs=opus";

      const recorder = new MediaRecorder(stream,{mimeType});
      mediaRecorder.current = recorder;
      audioChunks.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunks.current, { type: mimeType });
        const url = URL.createObjectURL(audioBlob);
        setAudioBlob(audioBlob);
        setVoiceNoteRecorded(true);
        setAudioURL(url);
      };

      recorder.start();
    } catch (error) {
      console.error("Error accessing microphone:", error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  };

  const handleDeleteVoiceNote = useCallback(()=>{
    setIsRecording(false);
    setVoiceNoteRecorded(false);
    setAudioURL(null);
    audioChunks.current = [];
    mediaRecorder.current?.stop();
  },[setIsRecording, setVoiceNoteRecorded]);

  const {getSharedKey} = useGetSharedKey();

  const handleSendVoiceNote = useCallback(async()=>{

    const sharedKey = await getSharedKey({loggedInUserId,otherMember:otherMember.user})
      dispatch(setReplyingToMessageData(null));
      dispatch(setReplyingToMessageId(null));

    if(sharedKey && audioBlob && selectedChatDetails){

      if(selectedChatDetails.isGroupChat){
        sendMessage(undefined,undefined,undefined,[],undefined,undefined,(await blobToUint8Array(audioBlob)) as Uint8Array<ArrayBuffer>);
      }
      else{
        const encryptedAudioBlob = await encryptAudioBlob({audioBlob,sharedKey});
        sendMessage(undefined,undefined,undefined,[],undefined,encryptedAudioBlob);
      }
      handleDeleteVoiceNote();
      mediaRecorder.current?.stop();
    }

  },[audioBlob, dispatch, getSharedKey, handleDeleteVoiceNote, loggedInUserId, otherMember.user, selectedChatDetails, sendMessage]);

  return (
    <motion.div
      variants={{ hide: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}
      initial="hide"
      animate="show"
      className={`flex ${voiceNoteRecorded?"max-sm:w-full max-sm:justify-between":""}`}
    >


      <div className="flex gap-3 items-center px-3 py-4">

        <button onClick={isRecording?stopRecording:startRecording}>
          <VoiceNoteMicIcon isRecording={isRecording}/>
        </button>

        {audioURL && (
            <audio controls className="w-[20rem] max-[520px]:w-[15rem] max-[428px]:w-[12rem] max-[380px]:w-[9rem]">
              <source src={audioURL!} type="audio/webm" />
            </audio>
        )}
      </div>
        
      {(!isRecording && !voiceNoteRecorded) && (
        <>
          <button
            key={1}
            onClick={() => toggleAttachmentsMenu((prev) => !prev)}
            className="px-3 py-4 justify-center items-center flex relative"
          >
            <AttachmentIcon />
          </button>

          <button
            key={2}
            onClick={toggleGifForm}
            type="button"
            className="px-3 py-4 hover:text-primary"
          >
            <GifIcon />
          </button>
        </>
      )}

      {
        voiceNoteRecorded && (
          <div className="flex items-center">
          <button
            onClick={handleDeleteVoiceNote}
            className="px-3 py-4 justify-center items-center flex relative"
          >
            <DeleteIcon />
          </button>

          <motion.button
            onMouseDown={(e) => e.preventDefault()}
            initial={{ x: 5, opacity: 0, position: "fixed" }}
            animate={{ x: 0, opacity: 1, position: "static" }}
            type="submit"
            className="bg-primary-dark h-fit self-center p-2 hover:bg-transparent transition-colors rounded-full"
            onClick={handleSendVoiceNote}
        >
            <SendIcon/>
          </motion.button>
        </div>
        )
      }

    </motion.div>
  );
};
