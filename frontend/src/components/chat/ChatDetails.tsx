'use client';
import { useToggleChatDetailsBar } from "@/hooks/useUI/useToggleChatDetailsBar";
import { fetchUserChatsResponse, FetchUserInfoResponse } from "@/lib/server/services/userService";
import { SharedMedia } from "../attachments/SharedMedia";
import { ChevronRightIcon } from "../ui/icons/ChevronRightIcon";
import { AddMemberOption } from "./AddMemberOption";
import { ChatDetailsHeader } from "./ChatDetailsHeader";
import { DisplayChatMembersAvatar } from "./DisplayChatMembersAvatar";
import { RemoveMemberOption } from "./RemoveMemberOption";


type PropTypes = {
    selectedChatDetails:fetchUserChatsResponse
    loggedInUser:FetchUserInfoResponse
}

export const ChatDetails = ({selectedChatDetails,loggedInUser}:PropTypes) => {

  const {toggleChatDetailsBar} = useToggleChatDetailsBar();

  const isGroupChat = selectedChatDetails.isGroupChat;
  const isAdmin = isGroupChat && selectedChatDetails.adminId === loggedInUser.id;

  return (
    <div className="flex flex-col justify-center items-center gap-y-7 text-text relative">
        
        <button onClick={toggleChatDetailsBar} className="absolute left-0 top-1 hidden max-2xl:block">
          <ChevronRightIcon/>
        </button>

        <ChatDetailsHeader
          chat={selectedChatDetails}
          loggedInUser={loggedInUser}
          isAdmin={isAdmin}
        />

        <div className="flex flex-col gap-y-6 w-full">
            
          <div className="flex flex-col gap-y-4">
              <div className="flex justify-between items-center">
                  <DisplayChatMembersAvatar members={selectedChatDetails.ChatMembers}/>
                  {isGroupChat && <span>See all</span>}
              </div>
              {
                isAdmin && 
                <>
                <AddMemberOption/>
                <RemoveMemberOption/>
                </>
              }
          </div>
          <SharedMedia key={selectedChatDetails.id}/>  
        </div>

    </div>
  )
}
