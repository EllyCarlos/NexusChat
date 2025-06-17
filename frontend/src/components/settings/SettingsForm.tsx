"use client";

import { updateUserNotificationStatus } from "@/actions/user.actions";
import { useDebounce } from "@/hooks/useUtils/useDebounce";
import { selectLoggedInUser, updateLoggedInUserNotificationStatus } from "@/lib/client/slices/authSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { startTransition, useActionState, useEffect, useState } from "react";
import toast from "react-hot-toast";

const SettingsForm = () => {

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const debouncedValue =  useDebounce(notificationsEnabled,500);

  const [state,updateUserNotificationStatusAction] =  useActionState(updateUserNotificationStatus,undefined);
  
  const loggedInUser = useAppSelector(selectLoggedInUser);

  const dispatch = useAppDispatch();
  
  useEffect(() => {
    if (loggedInUser) setNotificationsEnabled(loggedInUser.notificationsEnabled);
  }, [loggedInUser]);


  useEffect(()=>{
    if(state){
      if(state?.errors.message?.length) toast.error(state.errors.message);
      else if(state?.success.message?.length){
        toast.success(state.success.message);
        dispatch(updateLoggedInUserNotificationStatus(state.success.message.includes("enabled")?true:false))
      }
    }
  },[dispatch, state])



  useEffect(()=>{
    if(loggedInUser && debouncedValue!==null && debouncedValue !== loggedInUser.notificationsEnabled)
      startTransition(()=>{
        updateUserNotificationStatusAction({loggedInUserId:loggedInUser.id,notificationStatus:debouncedValue});
      })
  },[debouncedValue,loggedInUser])
  
  return (
    <div>
      <div className="flex justify-between items-center">
        <p>Notifications</p>
        <label className="inline-flex items-center cursor-pointer">
          {
            notificationsEnabled!==null && (
              <input
                onChange={()=>setNotificationsEnabled(!notificationsEnabled)}
                type="checkbox"
                checked={notificationsEnabled}
                className="sr-only peer"
              />
            )
          }
          <div className="relative w-11 h-6 bg-gray-200 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </div>
    </div>
  );
};

export default SettingsForm;
