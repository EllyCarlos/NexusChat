import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { PollOptionListItem } from "./PollOptionListItem";

type PropTypes = {
  options: string[];
  messageId: string;
  isMultipleAnswers: boolean;
  optionIndexToVotesMap: Record<number, {
    id: string;
    username: string;
    avatar: string;
  }[]>
};

export const PollOptionList = ({options,messageId,isMultipleAnswers,optionIndexToVotesMap}: PropTypes) => {

  const loggedInUserId =  useAppSelector(selectLoggedInUser)?.id as string;

  return (
    <div className="flex flex-col gap-y-3">
      {options.map((option, index) => (
        <PollOptionListItem
          key={index}
          optionIndex={index}
          option={option}
          totalOptions={options.length}
          messageId={messageId}
          loggedInUserId={loggedInUserId}
          isMultipleAnswers={isMultipleAnswers}
          optionIndexToVotesMap={optionIndexToVotesMap}
        />
      ))}
    </div>
  );
};
