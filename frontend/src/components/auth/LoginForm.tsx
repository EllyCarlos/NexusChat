"use client";
import { login } from "@/actions/auth.actions";
import {
  loginSchema,
  loginSchemaType,
} from "@/lib/shared/zod/schemas/auth.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { CircleLoading } from "../shared/CircleLoading";
import { AuthRedirectLink } from "./AuthRedirectLink";

export const LoginForm = () => {
  const [state, loginAction] = useActionState(login, undefined);
  const router = useRouter()

  useEffect(()=>{
    if(state?.redirect){
      router.push('/')
    }
    else if(state?.errors.message){
      toast.error(state.errors.message)
    }
  },[state,router])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<loginSchemaType>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = (data: loginSchemaType) => {
    const formData = new FormData();
    formData.append("email", data.email);
    formData.append("password", data.password);

    startTransition(() => {
      loginAction(formData);
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-4">
        <div className="flex flex-col gap-y-1">
          <input
            {...register("email")}
            name="email"
            className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary"
            placeholder="Email"
          />
          {errors.email?.message && (
            <p className="text-red-500 text-sm">{errors.email?.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-y-1">
          <input
            {...register("password")}
            name="password"
            type="password"
            className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary"
            placeholder="Password"
          />
          {errors.password?.message && (
            <p className="text-red-500 text-sm">{errors.password?.message}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-y-6">
        <div className="flex flex-col gap-y-2">
          {/* <SubmitButton btnText="Login"/> */}
          {SubmitButton()}
        </div>

        <div className="flex justify-between items-center flex-wrap gap-1">
          <AuthRedirectLink
            pageName="Signup"
            text="Create new account?"
            to="auth/signup"
          />
          <AuthRedirectLink
            pageName="forgot password"
            text="Need Help?"
            to="auth/forgot-password"
          />
        </div>
      </div>
    </form>
  );
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      type="submit"
      className={`w-full ${
        pending ? "bg-background" : "bg-primary"
      } text-white px-6 py-3 rounded shadow-lg font-medium text-center flex justify-center`}
    >
      {pending ? <CircleLoading size="6" /> : "Login"}
    </button>
  );
}
