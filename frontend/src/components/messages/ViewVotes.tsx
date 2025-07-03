import Image from "next/image";
import { selectVotesData } from "../../lib/client/slices/uiSlice";
import { useAppSelector } from "../../lib/client/store/hooks";

// Define the interface for a voter based on how it's destructured and used
interface Voter {
  id: string;
  username: string;
  avatar: string; // Assuming this is a string URL
}

const ViewVotes = () => {
  // votesData is typed based on selectVotesData from your Redux slice
  const votesData = useAppSelector(selectVotesData);

  return (
    votesData && (
      <div className="flex flex-col gap-y-8 select-none">
        <h6 className="font-medium text-xl">{votesData.question}</h6>

        <div className="flex flex-col gap-y-6">
          {/* Corrected: Type 'option' as 'string' */}
          {votesData.options?.map((option: string, index) => (
            <div key={index} className="flex flex-col gap-y-4">
              <div className="flex flex-col gap-y-1">
                <div className="flex justify-between">
                  <p className="text-base">{option}</p>
                  <p>
                    {votesData.optionIndexToVotesMap[index]?.length > 0
                      ? votesData.optionIndexToVotesMap[index].length === 1
                        ? "1 vote"
                        : `${votesData.optionIndexToVotesMap[index].length} Votes`
                      : "No votes"}
                  </p>
                </div>
                <div className="w-full h-[1px] bg-secondary-darker" />
              </div>

              <div className="flex flex-col gap-y-4 max-h-32 overflow-y-scroll">
                {/* Corrected: Type the destructured voter object as 'Voter' */}
                {votesData.optionIndexToVotesMap[index]?.map(({ id, username, avatar }: Voter) => (
                  <div key={id} className="flex gap-x-2 items-center">
                    <Image
                      width={100}
                      height={100}
                      className="size-6 rounded-full object-cover shrink-0"
                      src={avatar}
                      alt={"user-picture"}
                    />
                    <p>{username}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  );
};

export default ViewVotes;
// This component displays the votes for a poll, including the question, options, and voters for each option.