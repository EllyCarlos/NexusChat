import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { setCalleeIdPopulatedFromRecentCalls } from "@/lib/client/slices/callSlice";
import { setCallDisplay } from "@/lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserCallHistoryResponse } from "@/lib/server/services/callService";
import { formatCallDate } from "@/lib/shared/helpers";
import Image from "next/image";
import { ArrowDownLeft } from "../ui/icons/ArrowDownLeft";
import { ArrowUpRight } from "../ui/icons/ArrowUpRight";
import { CallIcon } from "../ui/icons/CallIcon";

type PropTypes = {
    callHistory: fetchUserCallHistoryResponse;
}

export const CallHistoryListItem = ({callHistory}:PropTypes) => {

    const loggedInUserId = useAppSelector(selectLoggedInUser)?.id as string;

    const avatar = callHistory.caller.id === loggedInUserId ? callHistory.callee.avatar : callHistory.caller.avatar;
    const username = callHistory.caller.id === loggedInUserId ? callHistory.callee.username : callHistory.caller.username;


    const disptach = useAppDispatch();

    const handleCallHistoryCallClick = ()=>{
        disptach(setCalleeIdPopulatedFromRecentCalls(callHistory.caller.id === loggedInUserId ? callHistory.callee.id : callHistory.caller.id));
        setTimeout(() => {
            disptach(setCallDisplay(true));
        }, 300);
    }


  return (
    <div className="flex justify-between">

        <div className="flex gap-2">
            <Image src={avatar} height={100} width={100} alt="user-avatar" className="bg-green-500 rounded-full size-14 object-cover"></Image>
            <div className="flex flex-col">
                <span className="text-text">{username}</span>
                <div className="flex gap-2">
                    <span className="self-center">{GetAppropriateArrowToShow({callHistory,loggedInUserId})}</span>
                    <span className="text-text text-sm">{formatCallDate(callHistory.startedAt.toString())}</span>
                </div>
            </div>
        </div>
        
        <button type="button" onClick={handleCallHistoryCallClick} className="self-center">
            <CallIcon size={6}/>
        </button>
    </div>
  )
}

function GetAppropriateArrowToShow({callHistory,loggedInUserId}:{callHistory:fetchUserCallHistoryResponse,loggedInUserId:string}){
    if(callHistory.status === 'COMPLETED'){
        return callHistory.caller.id === loggedInUserId ? <ArrowUpRight color="green"/> : <ArrowDownLeft color="green"/>
    }
    else{
        return callHistory.caller.id === loggedInUserId ? <ArrowUpRight color="red"/> : <ArrowDownLeft color="red"/>;
    }
}
