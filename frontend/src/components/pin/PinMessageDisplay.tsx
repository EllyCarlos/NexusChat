import { useDecryptMessage } from "@/hooks/useUtils/useDecryptMessage";
import { useGetMessagesByChatIdQuery } from "@/lib/client/rtk-query/message.api";
import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { selectPinnedMessageData } from "@/lib/client/slices/uiSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { format } from "date-fns";
import Image from "next/image";
import { useState } from "react";
import { AttachmentList } from "../messages/AttachmentList";
import { PollCard } from "../messages/PollCard";
import { Gif } from "../ui/Gif";
import { PinIcon } from "../ui/icons/PinIcon";
import { VoiceNote } from "../voiceNote/VoiceNote";

export const PinMessageDisplay = () => {

   const message =  useAppSelector(selectPinnedMessageData);
   const loggedInUserId = useAppSelector(selectLoggedInUser)?.id;

   const myMessage = message?.sender.id === loggedInUserId;
   const replyMessageId = 'asdf'

   const selectedChatDetails = useAppSelector(selectSelectedChatDetails) as fetchUserChatsResponse;

     const { messageWeRepliedTo } = useGetMessagesByChatIdQuery({chatId:selectedChatDetails.id,page:1},{
       selectFromResult:({data})=>({
         messageWeRepliedTo: data?.messages.find(msg=>msg.id === message?.replyToMessage?.id)
       })
     })

    const { decryptedMessage } = useDecryptMessage({
      cipherText:message?.textMessageContent as string,
      loggedInUserId:loggedInUserId!,
      selectedChatDetails,
    });

    const [readMore, setReadMore] = useState<boolean>(false);
    const isMessageLong = decryptedMessage?.length > 500;


  return (
    message && loggedInUserId && (
      <div
        className={`bg-primary text-white max-h-[40rem] min-w-full overflow-y-auto   rounded-2xl px-4 py-2 flex flex-col gap-y-1 justify-center max-md:max-w-80 max-sm:max-w-64
        ${replyMessageId === message.id ? `border-2 border-double border-spacing-4 ${myMessage?"white":"border-primary"}` : null}
        `}
      >

      
        <p className="text-secondary font-medium mb-2">
          {message.sender.id === loggedInUserId ? "You" : message.sender.username}
        </p>

        {
          message.replyToMessage && (
          <div className="flex flex-col bg-white/35 px-4 py-2 mb-2 rounded-xl max-sm:text-sm">
            <span className="text-sm font-semibold">{message.replyToMessage.sender.id === loggedInUserId ? "You" : message.replyToMessage.sender.username}</span>
            <div>{message.replyToMessage.attachments.length ? "attachment" : message.replyToMessage.audioUrl ? 'Voice note' : message.replyToMessage.isPollMessage ? 'Poll' : message.replyToMessage.textMessageContent ? messageWeRepliedTo?.decryptedMessage || 'deleted' : message.replyToMessage.url ? 
              <Image unoptimized className="size-10 object-contain" width={10} height={10} src={message.replyToMessage.url} alt="gif" />
            : "n/a"}</div>
          </div>
          )
        }
        {
          message.textMessageContent && (
            <span className="break-words max-sm:text-sm">
              {readMore ? decryptedMessage : decryptedMessage?.substring(0, 400)}
              {isMessageLong && (
                <span
                  className="font-medium cursor-pointer"
                  onClick={() => setReadMore(!readMore)}
                >
                  {readMore ? " Read less" : " Read more..."}
                </span>
              )}
            </span>
          )
        }
        {message.isPollMessage && (
          <PollCard messageId={message.id} pollData={message.poll!} votingAllowed={false}/>
        )}
        {message.url && <Gif url={message.url} />}
        {message.audioUrl && (
          <VoiceNote audioUrl={message.audioUrl} loggedInUserId={loggedInUserId} selectedChatDetails={selectedChatDetails}/>
        )}
        {message.attachments.length > 0 && (
          <AttachmentList attachments={message.attachments} />
        )}

        {/* time and edited mark */}
        <div className="flex items-center ml-auto gap-2 flex-nowrap shrink-0">
          {
            message.isEdited && (
              <span className="text-secondary font-medim text-sm max-sm:text-xs">
                Edited
              </span>
            )
          }
          <span>
            <PinIcon size={4}/>
          </span>
          <span className={`text-xs text-gray-200`}>
            {format(message.createdAt, "h:mm a").toLowerCase()}
          </span>
        </div>

      </div>

    )
  )
}
