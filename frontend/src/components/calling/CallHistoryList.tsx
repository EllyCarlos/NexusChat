import { fetchUserCallHistoryResponse } from "@/lib/server/services/callService";
import { CallHistoryListItem } from "./CallHistoryListItem";

type PropTypes = {
  callHistory: fetchUserCallHistoryResponse[];
};

export const CallHistoryList = ({ callHistory }: PropTypes) => {
  return (
    <div className="flex flex-col gap-4">
      {callHistory.map((callHistory) => {
        return (
          <CallHistoryListItem callHistory={callHistory} key={callHistory.id} />
        );
      })}
    </div>
  );
};
