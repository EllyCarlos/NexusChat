import { useHandleVoteClick } from "@/hooks/useMessages/useHandleVoteClick";
import { motion } from "framer-motion";
import { DefaultPollOptionDot } from "../ui/DefaultPollOptionDot";
import { FilledGreenDot } from "../ui/FilledGreenDot";

type PropTypes = {
  messageId: string;
  loggedInUserId: string;
  isMultipleAnswers: boolean;
  optionIndex: number;
  totalOptions: number;
  optionIndexToVotesMap: Record<number, {
    id: string;
    username: string;
    avatar: string;
}[]>
};

export const VoteButton = ({
  messageId,
  loggedInUserId,
  isMultipleAnswers,
  optionIndex,
  totalOptions,
  optionIndexToVotesMap,
}: PropTypes) => {
  
  const currentOptionVotes = optionIndexToVotesMap[optionIndex];
  const haveUserVotedInThisOption = currentOptionVotes?.some(({id})=>id===loggedInUserId);

  const { handleVoteClick } = useHandleVoteClick({
    isMultipleAnswers,
    loggedInUserId,
    messageId,
    totalOptions,
    haveUserVotedInThisOption,
    optionIndex,
    optionIndexToVotesMap
  });

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={handleVoteClick}
    >
      {haveUserVotedInThisOption ? <FilledGreenDot /> : <DefaultPollOptionDot />}
    </motion.button>
  );
};
