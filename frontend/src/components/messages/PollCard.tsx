import { useToggleViewVotes } from "@/hooks/useUI/useToggleViewVotes";
import { Message } from "@/interfaces/message.interface";
import { setVotesData } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { MouseEvent, useCallback } from "react";
import { PollOptionList } from "./PollOptionList";

type PropTypes = {
  pollData: NonNullable<Message["poll"]>;
  messageId:string
  votingAllowed?: boolean;
};

export const PollCard = ({ pollData, messageId, votingAllowed=true}: PropTypes) => {

  // [optionIndex]:[votes[]]
  // i.e [optionIndex] : [{id,username,avatar},{id,username,avatar}...]

  const optionIndexToVotesMap:Record<number,{id:string,username:string,avatar:string}[]> = {};
  
  pollData?.votes?.forEach(({user,optionIndex})=>{
    if(optionIndexToVotesMap[optionIndex]){
      optionIndexToVotesMap[optionIndex].push(user)
    }
    else{
      optionIndexToVotesMap[optionIndex] = [user]
    }
  });

  const { toggleViewVotes } = useToggleViewVotes();
  const dispatch = useAppDispatch();

  const handleViewVotesClick = useCallback((e: MouseEvent<HTMLButtonElement, globalThis.MouseEvent>) => {
    e.stopPropagation();
    e.preventDefault();
    dispatch(setVotesData({options:pollData.options,optionIndexToVotesMap,question:pollData.question}));
    toggleViewVotes();
  },[]);


  return (
    <div className="flex flex-col gap-y-4 min-w-56">
      <div>
        <h6 className="text-lg font-medium">{pollData.question}</h6>
        {
          !votingAllowed && <span className="text-sm">Polls can&apos;t be voted from here</span>
        }
      </div>
    <div className={`${!votingAllowed?"pointer-events-none":""}`}>
        <PollOptionList
          messageId={messageId}
          options={pollData.options}
          isMultipleAnswers={pollData.multipleAnswers}
          optionIndexToVotesMap={optionIndexToVotesMap}
        />
    </div>
      <span className="bg-white w-full h-[1px]"/>
      <button type="button" onClick={handleViewVotesClick} className="text-center">
        View votes
      </button>
    </div>
  );
};
