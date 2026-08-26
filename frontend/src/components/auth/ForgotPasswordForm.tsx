"use client";
import { forgotPassword } from '@/actions/auth.actions';
import {
  forgotPasswordSchema,
  forgotPasswordSchemaType,
} from "@/lib/shared/zod/schemas/auth.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { CircleLoading } from "../shared/CircleLoading";

export const ForgotPasswordForm = () => {
  const [isPending, startTransition] = useTransition();
  const [submissionInFlight, setSubmissionInFlight] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
    resetField,
  } = useForm<forgotPasswordSchemaType>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit: SubmitHandler<forgotPasswordSchemaType> = ({ email }) => {
    if (isPending || submissionInFlight) {
      return;
    }

    setSubmissionInFlight(true);
    startTransition(async () => {
      try {
        const result = await forgotPassword(null, email);
        const errorMessage = result.errors.message;
        const successMessage = result.success.message;

        if (errorMessage) {
          toast.error(errorMessage);
          return;
        }

        if (successMessage) {
          toast.success(successMessage);
          resetField("email");
        }
      } catch {
        toast.error("Unable to request a password reset. Please try again.");
      } finally {
        setSubmissionInFlight(false);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-y-4">
      <input
        {...register("email")}
        className="p-3 rounded outline outline-1 outline-secondary-dark text-text bg-background hover:outline-primary"
        placeholder="Registered Email"
      />
      {errors.email?.message && <p className="text-red-500 text-sm">{errors.email.message}</p>}
      <SubmitButton pending={isPending || submissionInFlight} />
    </form>
  );
};

function SubmitButton({ pending }: { pending: boolean }) {

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
  );
}
