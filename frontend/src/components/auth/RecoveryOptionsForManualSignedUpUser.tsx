import { verifyPassword } from "@/actions/auth.actions";
import { useStoreLoggedInUserInfoInLocalStorageIfCorrectPasswordIsEntered } from "@/hooks/useAuth/useStoreLoggedInUserInfoInLocalStorageIfCorrectPasswordIsEntered";
import { useStorePasswordInLocalStorageIfCorrectPasswordIsEntered } from "@/hooks/useAuth/useStorePasswordInLocalStorageIfCorrectPasswordIsEntered";
import { FetchUserInfoResponse } from "@/lib/server/services/userService";
import {
  keyRecoverySchema,
  keyRecoverySchemaType,
} from "@/lib/shared/zod/schemas/auth.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { SubmitHandler, useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { CircleLoading } from "../shared/CircleLoading";

type PropTypes = {
  loggedInUser: FetchUserInfoResponse | null;
};

export const RecoveryOptionsForManualSignedUpUser = ({loggedInUser}: PropTypes) => {

  const [state,verifyPasswordAction] =  useActionState(verifyPassword,undefined);

  useEffect(()=>{
    if(state?.errors.message){
      toast.error(state.errors.message);
    }
    else if(state?.success.message){
      toast.success(state.success.message);
    }
  },[state])

  const {register,handleSubmit,watch,formState: { errors },} = useForm<keyRecoverySchemaType>({resolver: zodResolver(keyRecoverySchema)});

  const onSubmit: SubmitHandler<keyRecoverySchemaType> = ({ password }) => {
    if(loggedInUser){
      startTransition(()=>{
        verifyPasswordAction({userId:loggedInUser?.id,password})
      })
    }
  }

  useStorePasswordInLocalStorageIfCorrectPasswordIsEntered({
    isSuccess:state?.success?.message?.length ? true : false,
    passwordRef: watch("password"),
  });
  useStoreLoggedInUserInfoInLocalStorageIfCorrectPasswordIsEntered({
    isSuccess:state?.success?.message?.length ? true : false,
    loggedInUser,
  });

  return state?.success?.message ? (
    <h2 className="text font-bold bg-background p-4 rounded-md">
      We have sent an verification email, please check spam if not received
    </h2>
  ) : (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-2">
        <input {...register("password")} type="password" className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary" placeholder="Password"/>
        {errors.password?.message && <p className="text-red-500 text-sm">{errors.password?.message}</p>}
      </div>
      <SubmitButton/>
    </form>
  );
};

function SubmitButton(){

  const {pending} = useFormStatus();

  return (
    <button
    type="submit"
    className={`bg-primary px-14 py-2 self-center rounded-sm ${
      pending ? "bg-transparent" : ""
    }`}
  >
    {pending ? <CircleLoading size="6" /> : "Verify Password"}
  </button>
  )
}
