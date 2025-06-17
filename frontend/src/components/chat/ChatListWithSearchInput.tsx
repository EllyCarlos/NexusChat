"use client";
import { useChatListSearch } from "@/hooks/useChat/useChatListSearch";
import { useFilteredChatsVisibility } from "@/hooks/useChat/useFilteredChatsVisibility";
import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { SearchInputForChatList } from "../ui/SearchInput";
import { ChatList } from "./ChatList";
import { selectCallHistoryTabSelected, setCallHistoryTabSelected } from "@/lib/client/slices/uiSlice";
import { CallIcon } from "../ui/icons/CallIcon";
import { useCallback } from "react";
import { CallHistoryList } from "../calling/CallHistoryList";
import { selectCallHistory } from "@/lib/client/slices/callSlice";
import { ChatBubbleIcon } from "../ui/icons/ChatBubbleIcon";

type PropTypes = {
  chats: fetchUserChatsResponse[];
};

export const ChatListWithSearchInput = ({ chats }: PropTypes) => {

  const loggedInUserId = useAppSelector(selectLoggedInUser)?.id as string;
  const callHistory = useAppSelector(selectCallHistory);

  const { filteredChats, searchVal ,setSearchVal} = useChatListSearch({chats,loggedInUserId});
  const { showFilteredChats } = useFilteredChatsVisibility({filteredChats,searchVal});

  const callHistoryTabSelected =  useAppSelector(selectCallHistoryTabSelected);

  const dispatch = useAppDispatch();
  const historyTabSelected = useAppSelector(selectCallHistoryTabSelected);

  const handleCallHistoryTabClick = useCallback(()=>{
    dispatch(setCallHistoryTabSelected(!historyTabSelected));
  },[dispatch, historyTabSelected])

  const handleChatsClick = useCallback(()=>{
    dispatch(setCallHistoryTabSelected(false));
  },[dispatch])

  return (
    <div className="flex flex-col gap-y-5 relative min-h-full">
      {
        callHistoryTabSelected?(
          <div className="flex flex-col gap-6">
            <h1 className="text-text text-2xl">Recent Calls</h1>
            {
              callHistory.length === 0 ? (
                <span className="text-text self-center text-center mt-4 mb-4">No recent calls</span>
              ):
              (
                <CallHistoryList callHistory={callHistory}/>
              )
            }
          </div>
        ):
        (
          <>
            <SearchInputForChatList
              searchVal={searchVal}
              setSearchVal={setSearchVal}
            />
            {
              chats.length === 0 ? (
                  <span className="text-text self-center text-center px-2 mt-4 mb-4">Click on your profile, make friends by sending a friend request<br /> and start chatting</span>
              ):(
                <ChatList
                  chats={showFilteredChats ? filteredChats : chats}
                  isFiltered={showFilteredChats}
                />
              )
            }
          </>
        )
      }
      
      <div className={`bg-background/100  w-full py-3 px-3 -bottom-5 sticky z-50 flex gap-7 rounded-md`}>

        <button onClick={handleChatsClick} type="button">
          <div className={`flex flex-col items-center gap-2 ${!callHistoryTabSelected?"bg-secondary-dark":""} px-5 py-2 rounded-md`}>
            <span><ChatBubbleIcon/></span>
            <span className="text-text text-sm">Chats</span>
          </div>
        </button>

        <button onClick={handleCallHistoryTabClick} type="button">
          <div className={`flex flex-col items-center gap-2 ${callHistoryTabSelected?"bg-secondary-dark":""} px-5 py-2 rounded-md`}>
            <span><CallIcon/></span>
            <span className="text-text text-sm">Calls</span>
          </div>
        </button>

      </div>

    </div>
  );
};
