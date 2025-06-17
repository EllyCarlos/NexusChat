"use client";
import { resetPassword } from "@/actions/auth.actions";
import {
  resetPasswordSchema,
  resetPasswordSchemaType,
} from "@/lib/shared/zod/schemas/auth.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { SubmitHandler, useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { CircleLoading } from "../shared/CircleLoading";

type PropTypes = {
  token: string;
};

export const ResetPasswordForm = ({ token }: PropTypes) => {

  const [state,resetPasswordAction] = useActionState(resetPassword,undefined);

  const router = useRouter();

  const {register,handleSubmit,formState: { errors }} = useForm<resetPasswordSchemaType>({resolver: zodResolver(resetPasswordSchema)});

  useEffect(()=>{
    if(state?.errors.message?.length){
      toast.error(state.errors.message);
    }
    else if(state?.success.message?.length){
      toast.success(state.success.message)
      router.push("/auth/login")
    }
  },[state])

  const onSubmit: SubmitHandler<resetPasswordSchemaType> = ({ newPassword }) => {
    startTransition(()=>{resetPasswordAction({newPassword,token})});
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-y-4">

      <input {...register("newPassword")} type="password" className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary" placeholder="New password"/>
      {errors.newPassword?.message && <p className="text-red-500 text-sm">{errors.newPassword?.message}</p>}

      <input {...register("confirmPassword")} type="password" className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary" placeholder="Confirm new password"/>
      {errors.confirmPassword?.message && <p className="text-red-500 text-sm">{errors.confirmPassword?.message}</p>}

      {SubmitButton()}
    </form>
  );
};

function SubmitButton(){

  const {pending} = useFormStatus();

  return (
    <button
      disabled={pending}
      type="submit"
      className={`w-full ${
        pending ? "bg-background" : "bg-primary"
      } text-white px-6 py-3 rounded shadow-lg font-medium text-center flex justify-center disabled:bg-gray-400`}
    >
      {pending ? <CircleLoading size="6" /> : "Update Password"}
    </button>
  )
}