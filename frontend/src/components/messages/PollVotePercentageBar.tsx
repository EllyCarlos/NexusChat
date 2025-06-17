type PropTypes = {
  optionIndex:number;
  totalOptions: number;
  optionIndexToVotesMap: Record<number, {
    id: string;
    username: string;
    avatar: string;
}[]>
};

export const PollVotePercentageBar = ({optionIndex,totalOptions,optionIndexToVotesMap}: PropTypes) => {

  const votesInThisOption = optionIndexToVotesMap[optionIndex]?.length;

  const calculateVotePercentage = () => {
    const percentage = (votesInThisOption/totalOptions) * 100;
    return Math.min(Math.round(percentage), 100)
  };

  return (
    <div
      style={{ width: `${calculateVotePercentage() || 0}%` }}
      className={`h-2 bg-green-500 self-start transition-all rounded-2xl`}
    />
  );
};
