import { searchUser } from "@/actions/user.actions";
import { useDebounce } from "@/hooks/useUtils/useDebounce";
import { useGetUserFriendRequestsQuery } from "@/lib/client/rtk-query/request.api";
import { startTransition, useActionState, useEffect, useState } from "react";
import { useSendFriendRequest } from "../../hooks/useFriend/useSendFriendRequest";
import { selectLoggedInUser } from "../../lib/client/slices/authSlice";
import { useAppSelector } from "../../lib/client/store/hooks";
import { CircleLoading } from "../shared/CircleLoading";
import { UserList } from "./UserList";

const AddFriendForm = () => {

  const [state,searchUserAction] = useActionState(searchUser,undefined);

  const [loading,setLoading] = useState<boolean>(false);

  const [inputVal, setInputVal] = useState<string>("");
  const loggedInUserId = useAppSelector(selectLoggedInUser)?.id;

  const { data: friends } = useGetUserFriendRequestsQuery();

  const { sendFriendRequest } = useSendFriendRequest();

  const debouncedInputVal = useDebounce(inputVal, 600);

  useEffect(() => {
    if (debouncedInputVal) {
      setLoading(true);
      startTransition(()=>{
        searchUserAction({username:debouncedInputVal})
        setLoading(false);
      })
    }
  }, [debouncedInputVal]);

  const hanldeSendFriendRequest = (receiverId: string) => {
    sendFriendRequest({ receiverId });
  };

  return (
    <div className="flex flex-col gap-y-4 min-h-72 max-h-96 overflow-y-auto">
      <input
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        className="p-3 rounded text-text bg-background w-full border-none outline-none"
        type="text"
        placeholder="Search username"
      />

      <div>
        {
          loading && (
            <div className="flex justify-center mt-5">
              <CircleLoading/>
            </div>
          )
        }
        {(!loading && state?.data && friends && loggedInUserId) ? (
          <UserList
            users={state.data}
            friends={friends}
            loggedInUserId={loggedInUserId}
            sendFriendRequest={hanldeSendFriendRequest}
          />
        ) 
        :(
          !loading && !inputVal?.trim() &&
          !state?.data?.length && (
            <p className="text-center mt-16">Go on try the speed!</p>
          )
        )}
      </div>
    </div>
  );
};

export default AddFriendForm;
