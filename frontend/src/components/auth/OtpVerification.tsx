"use client";

import { logout, sendOtp } from "@/actions/auth.actions";
import { FormEvent, startTransition, useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import toast from "react-hot-toast";
import { CircleLoading } from "../shared/CircleLoading";
import { OtpVerificationForm } from "./OtpVerificationForm";
import { useRouter } from "next/navigation";

type PropTypes = {
  email: string;
  loggedInUserId: string;
  username: string;
}

export const OtpVerification = ({email,loggedInUserId,username}:PropTypes) => {

  const [state,sendOtpAction] = useActionState(sendOtp,undefined);

  useEffect(()=>{
    if(state?.errors.message?.length) toast.error(state.errors.message);
    if(state?.success.message?.length) toast.success(state.success.message);
  },[state])

  const handleSubmit = (e: FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    startTransition(()=>{
      sendOtpAction({email,loggedInUserId,username});
    })
  }

  const router = useRouter();

  const handleLogoutClick = async()=>{
    await logout();
    router.push("/auth/login");
  }

  return (
    state?.success.message?.length ? (
      <OtpVerificationForm loggedInUserId={loggedInUserId}/>
    )
    :
    (
      <div className="flex gap-4">
    <form onSubmit={handleSubmit}>
      <SubmitButton/>
    </form>
    <button onClick={handleLogoutClick} className={"bg-primary px-6 py-2 rounded-sm max-sm:w-full"}>
        Logout Instead</button>
    </div>
    )
  );
};

function SubmitButton(){

  const {pending} = useFormStatus();

  return (
    <button
    disabled={pending}
    type="submit"
    className={`${pending?"bg-transparent":"bg-primary"} px-6 py-2 rounded-sm max-sm:w-full`}
  >
    {pending ? <CircleLoading/> : "Get OTP"}
  </button>
  )
}
