"use client";
import { resetPassword } from "@/actions/auth.actions";
import {
  forgotPasswordSchema,
  forgotPasswordSchemaType,
} from "@/lib/shared/zod/schemas/auth.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { SubmitHandler, useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { CircleLoading } from "../shared/CircleLoading";

export const ForgotPasswordForm = () => {

  const {register,handleSubmit,formState: { errors },setValue,} = useForm<forgotPasswordSchemaType>({resolver: zodResolver(forgotPasswordSchema)});

  const [state,resetPasswordAction] =  useActionState(resetPassword,undefined);

  const onSubmit: SubmitHandler<forgotPasswordSchemaType> = ({ email }) => {
    startTransition(()=>{resetPasswordAction(email)})
    setValue("email", "");
  };

  useEffect(()=>{
    if(state?.errors.message?.length){
      toast.error(state.errors.message);
    }
    else if(state?.success.message?.length){
      toast.success(state.success.message);
    }
  },[state])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-y-4">
      <input
        {...register("email")}
        className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary"
        placeholder="Registered Email"
      />
      {errors.email?.message && <p className="text-red-500 text-sm">{errors.email.message}</p>}
      <SubmitButton/>
    </form>
  );
};

function SubmitButton(){

  const { pending } = useFormStatus();

  return (
    <button
    disabled={pending}
    type="submit"
    className={`w-full ${
      pending ? "bg-background" : "bg-primary"
    } text-white px-6 py-3 rounded shadow-lg font-medium text-center flex justify-center`}
  >
    {pending ? <CircleLoading size="6" /> : "Send reset link"}
  </button>
  )
}
