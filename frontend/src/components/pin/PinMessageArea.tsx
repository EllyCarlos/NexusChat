import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";
import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { MouseEvent, useCallback, useEffect, useState } from "react";
import { ChevronDownIcon } from "../ui/icons/ChevronDownIcon";
import { PinIcon } from "../ui/icons/PinIcon";
import { UnpinIcon } from "../ui/icons/UnpinIcon";
import { setPinnedMessageData, setPinnedMessageDisplay } from "@/lib/client/slices/uiSlice";

type PropTypes = {
    selectedChatDetails: fetchUserChatsResponse;
}

type UnpinMessageEventSendPayload = {
    pinId:string
}

export const PinMessageArea = ({selectedChatDetails}:PropTypes) => {

    const [activePinIndex,setActivePinIndex] = useState<number>(selectedChatDetails.PinnedMessages.length-1);

    const dispatch = useAppDispatch();

    useEffect(()=>{
        setActivePinIndex(selectedChatDetails.PinnedMessages.length-1)
    },[selectedChatDetails.PinnedMessages.length])

    const socket = useSocket();

    const handlePinAreaClick = useCallback(()=>{
        if(activePinIndex === selectedChatDetails.PinnedMessages.length-1){
            setActivePinIndex(0);
            return;
        }
        setActivePinIndex(prev=>prev+1);
    },[activePinIndex, selectedChatDetails.PinnedMessages.length]);

    const handleUnpinClick = useCallback((e:MouseEvent<HTMLButtonElement, globalThis.MouseEvent>)=>{
        e.stopPropagation();
        const payload:UnpinMessageEventSendPayload = {
            pinId:selectedChatDetails.PinnedMessages[activePinIndex].id
        }
        socket?.emit(Event.UNPIN_MESSAGE,payload);
    },[activePinIndex, selectedChatDetails.PinnedMessages, socket]);
    
    const pinnedMessage = selectedChatDetails.PinnedMessages[activePinIndex];
    
    const handleViewPinnedMessageClick = useCallback((e: MouseEvent<HTMLButtonElement, globalThis.MouseEvent>)=>{
        e.stopPropagation();
        dispatch(setPinnedMessageDisplay(true));
        dispatch(setPinnedMessageData(pinnedMessage?.message))
    },[dispatch, pinnedMessage?.message])


    const loggedInUserId = useAppSelector(selectLoggedInUser)?.id as string

  return (
    <div className="bg-secondary-dark w-full flex h-12 py-2 px-2 items-center text-text gap-3 max-sm:text-sm" onClick={handlePinAreaClick}>

        <div className="flex items-center gap-4">
            <div className="flex flex-col gap-2">
                {
                    selectedChatDetails.PinnedMessages.map((message,index)=>(
                        <span key={message?.id} className={`text-xs ${index==activePinIndex?"bg-green-500":"bg-secondary-darker"} h-2 w-1 rounded-md`}>
                        </span>
                    ))
                }
            </div>
            <PinIcon/>
        </div>
        
        <div>
            <span className="text-primary font-semibold">{pinnedMessage?.message?.sender.id === loggedInUserId ? "You" : pinnedMessage?.message?.sender.username}:{" "}</span>
            <span className="">
                {
                    pinnedMessage?.message?.audioUrl ? "voice note": pinnedMessage?.message?.textMessageContent ? "text message": pinnedMessage?.message?.attachments?.length ? "attachment": pinnedMessage?.message?.url ? "gif": pinnedMessage?.message?.isPollMessage ? "poll": "deleted message"
                }
            </span>
        </div>
        
        <div className="ml-auto flex gap-4 items-center">
            <button type="button" onClick={handleViewPinnedMessageClick}>
                <ChevronDownIcon/>
            </button>
            {
                pinnedMessage?.message?.sender?.id === loggedInUserId && (
                <button type="button" className="cursor-pointer" onClick={handleUnpinClick} >
                    <UnpinIcon/>
                </button>
                )
            }
        </div>

    </div>
  )
}
