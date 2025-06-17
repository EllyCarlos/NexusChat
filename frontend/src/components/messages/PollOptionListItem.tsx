import { Display2RecentVotesAndRemaningVotesCount } from "./Display2RecentVotesAndRemaningVotesCount";
import { PollVotePercentageBar } from "./PollVotePercentageBar";
import { VoteButton } from "./VoteButton";

type PropTypes = {
  optionIndex: number;
  option: string;
  totalOptions: number;
  messageId: string;
  loggedInUserId: string;
  isMultipleAnswers: boolean;
  optionIndexToVotesMap: Record<number, {
    id: string;
    username: string;
    avatar: string;
}[]>
};

export const PollOptionListItem = ({option,optionIndex,messageId,loggedInUserId,totalOptions,isMultipleAnswers,optionIndexToVotesMap}: PropTypes) => {
  return (
    <div className="flex flex-col gap-y-2 justify-center">
      <div className="flex items-center justify-between">
        <div className="flex gap-x-2">
          <VoteButton
            optionIndex={optionIndex}
            isMultipleAnswers={isMultipleAnswers}
            loggedInUserId={loggedInUserId}
            messageId={messageId}
            totalOptions={totalOptions}
            optionIndexToVotesMap={optionIndexToVotesMap}
          />
          <p className="break-words">{option}</p>
        </div>
        <Display2RecentVotesAndRemaningVotesCount optionIndexToVotesMap={optionIndexToVotesMap}  optionIndex={optionIndex} />
      </div>
      <PollVotePercentageBar totalOptions={totalOptions} optionIndex={optionIndex} optionIndexToVotesMap={optionIndexToVotesMap}/>
    </div>
  );
};
