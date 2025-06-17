import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { useVoteIn } from "./useVoteIn";
import { useVoteOut } from "./useVoteOut";

type PropTypes = {
  messageId: string;
  loggedInUserId: string;
  isMultipleAnswers: boolean;
  optionIndex: number;
  totalOptions: number;
  haveUserVotedInThisOption: boolean;
  optionIndexToVotesMap: Record<number, {
    id: string;
    username: string;
    avatar: string;
}[]>
};

export const useHandleVoteClick = ({
  optionIndex,
  isMultipleAnswers,
  loggedInUserId,
  messageId,
  haveUserVotedInThisOption,
  totalOptions,
  optionIndexToVotesMap
}: PropTypes) => {
  
  const { handleVoteIn } = useVoteIn();
  const { handleVoteOut } = useVoteOut();

  const chatId =  useAppSelector(selectSelectedChatDetails)?.id as string;

  const handleVoteClick = () => {
    console.log('user clicked vote button','option',optionIndex);
    if (haveUserVotedInThisOption) {
      console.log('voting out');
      // if already voted then clicking it again means voting out
      handleVoteOut({chatId,messageId,optionIndex:optionIndex});
    } 
    else {
      // if not voted already, then it means voting for the first time
      // but there exists two cases
      // 1. single answer poll
      // 2. multiple answer poll

      // if multiple answer poll, then we can directly vote in to the current option

      if (!isMultipleAnswers) {
        // if single answer poll, then we need to check if user has voted any option or not
        // if yes, then we need to find that option and vote out from that option and vote in to the current option

        // in this loop
        // we are checking every option for the user's vote
        // and if we find any then we vote out from that option
        for (let i = 0; i < totalOptions; i++) {
          const currentOptionVotes = optionIndexToVotesMap[i];
          for(let j = 0; j<currentOptionVotes?.length ; j++){
            const vote = currentOptionVotes[j];
            if(vote.id === loggedInUserId){
              handleVoteOut({chatId,messageId,optionIndex:i});
              break;
            }
          }
        }
        console.log('voting out from previous option and then');
      }
      // and vote in remains the same for both cases
      setTimeout(() => {
        handleVoteIn({ chatId, messageId, optionIndex });
      }, 0); // Small delay (300ms) to let vote out process complete
      console.log('voting in to new option');
    }
  };

  return { handleVoteClick };
};
