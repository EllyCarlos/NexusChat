"use client";
import { signup } from "@/actions/auth.actions";
import { useConvertPrivateAndPublicKeyInJwkFormat } from "@/hooks/useAuth/useConvertPrivateAndPublicKeyInJwkFormat";
import { useEncryptPrivateKeyWithUserPassword } from "@/hooks/useAuth/useEncryptPrivateKeyWithUserPassword";
import { useGenerateKeyPair } from "@/hooks/useAuth/useGenerateKeyPair";
import { useStoreUserKeysInDatabase } from "@/hooks/useAuth/useStoreUserKeysInDatabase";
import { useStoreUserPrivateKeyInIndexedDB } from "@/hooks/useAuth/useStoreUserPrivateKeyInIndexedDB";
import { useUpdateLoggedInUserPublicKeyInState } from "@/hooks/useAuth/useUpdateLoggedInUserPublicKeyInState";
import type { signupSchemaType } from "@/lib/shared/zod/schemas/auth.schema";
import { signupSchema } from "@/lib/shared/zod/schemas/auth.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { SubmitHandler, useForm, useWatch } from "react-hook-form";
import toast from "react-hot-toast";
import { CircleLoading } from "../shared/CircleLoading";
import { AuthRedirectLink } from "./AuthRedirectLink";

export const SignupForm = () => {
  const [state, signupAction] = useActionState(signup, undefined);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<signupSchemaType>({ resolver: zodResolver(signupSchema) });

  const password = useWatch({ control, name: "password" });

  useEffect(()=>{
    if(state?.errors?.message){
      toast.error(state.errors.message)
    }
  },[state,router])

  const { privateKey, publicKey } = useGenerateKeyPair({ user: state?.data });
  const { privateKeyJWK, publicKeyJWK } = useConvertPrivateAndPublicKeyInJwkFormat({ privateKey, publicKey });
  const { encryptedPrivateKey } = useEncryptPrivateKeyWithUserPassword({password,privateKeyJWK});
  const {publicKeyReturnedFromServerAfterBeingStored} = useStoreUserKeysInDatabase({ encryptedPrivateKey, publicKeyJWK, shouldStoreKeys:Boolean(state?.data?.id)});
  useStoreUserPrivateKeyInIndexedDB({privateKey: privateKeyJWK,userId: state?.data?.id});
  useUpdateLoggedInUserPublicKeyInState({publicKey: publicKeyReturnedFromServerAfterBeingStored});

  const onSubmit: SubmitHandler<signupSchemaType> = (data) => {
    const formData = new FormData();

    formData.append("name", data.name);
    formData.append("username", data.username);
    formData.append("email", data.email);
    formData.append("password", data.password);

    startTransition(() => {
      signupAction(formData);
    });
  };

  return (
    <form className="flex flex-col gap-y-6" onSubmit={handleSubmit(onSubmit)}>
      <div className="flex flex-col gap-y-4">
        <div className="flex flex-col gap-y-1">
          <input
            {...register("name")}
            className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary"
            placeholder="Name"
          />
          {errors.name?.message && (
            <p className="text-red-500 text-sm">{errors.name?.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-y-1">
          <input
            {...register("username")}
            className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary"
            placeholder="Username"
          />
          {errors.username?.message && (
            <p className="text-red-500 text-sm">{errors.username?.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-y-1">
          <input
            {...register("email")}
            className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary"
            placeholder="Email"
          />
          {errors.email?.message && (
            <p className="text-red-500 text-sm">{errors.email?.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-y-1">
          <input
            type="password"
            {...register("password")}
            className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary"
            placeholder="Password"
          />
          {errors.password?.message && (
            <p className="text-red-500 text-sm">{errors.password?.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-y-1">
          <input
            type="password"
            {...register("confirmPassword")}
            className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary"
            placeholder="Confirm Password"
          />
          {errors.confirmPassword?.message && (
            <p className="text-red-500 text-sm">
              {errors.confirmPassword?.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-y-6">
        <div className="flex flex-col gap-y-2">
          <SubmitButton />
        </div>
        <AuthRedirectLink
          pageName="Login"
          text="Already a member?"
          to="auth/login"
        />
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
      {pending ? <CircleLoading size="6" /> : "Signup"}
    </button>
  );
}
