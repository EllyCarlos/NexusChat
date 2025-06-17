import {
  pollSchema,
  pollSchemaType,
} from "@/lib/shared/zod/schemas/message.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { SubmitHandler, useFieldArray, useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { useSendMessage } from "../../hooks/useMessages/useSendMessage";
import { useTogglePollForm } from "../../hooks/useUI/useTogglePollForm";
import { FormInput } from "../ui/FormInput";
import { SubmitButton } from "../ui/SubmitButton";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { PlusIconWithoutCircle } from "../ui/icons/PlusIconWithoutCircle";
import { setReplyingToMessageData, setReplyingToMessageId } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";

const PollForm = () => {
  const { sendMessage } = useSendMessage();
  const { togglePollForm } = useTogglePollForm();

  const [isMultipleAnswers, setIsMultipleAnswers] = useState<boolean>(false);

  const dispatch = useAppDispatch();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<pollSchemaType>({ resolver: zodResolver(pollSchema) });

  const { fields, append } = useFieldArray({
    name: "options",
    control,
  });

  const handleAddOption = () => {
    if (fields.length !== 5) {
      append({ optionValue: "" });
    } else {
      toast.error("You cannot add more than 5 options");
    }
  };

  const onSubmit: SubmitHandler<pollSchemaType> = ({ options, question }) => {
    if (!options.length) {
      toast.error("Please provide options");
      return;
    }

    if (options.length < 2) {
      toast.error("Atleast 2 options are needed for creating a poll");
      return;
    }

    sendMessage(
      undefined,
      undefined,
      question,
      options.map((option) => option.optionValue),
      isMultipleAnswers
    );
    dispatch(setReplyingToMessageData(null));
    dispatch(setReplyingToMessageId(null));
    togglePollForm();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-y-7">
      <h5 className="text-fluid-h5">Create Poll</h5>

      <div className="flex flex-col gap-y-6">
        <FormInput
          register={{ ...register("question") }}
          placeholder="Ask question"
          error={errors.question?.message}
        />

        <div className="flex flex-col gap-y-4">
          <div className="flex items-center gap-x-2">
            <p>Options</p>
            <button onClick={handleAddOption} type="button">
              <PlusIconWithoutCircle />
            </button>
          </div>

          {fields.map((feild, index) => (
            <FormInput
              key={feild.id}
              register={{ ...register(`options.${index}.optionValue`) }}
              placeholder="+ Add"
              error={errors.options?.message}
            />
          ))}

          {fields.length > 0 && (
            <div className="flex items-center justify-between">
              <p>Allow multiple answers</p>
              <ToggleSwitch
                initialValue={isMultipleAnswers}
                toggle={() => setIsMultipleAnswers(!isMultipleAnswers)}
              />
            </div>
          )}
        </div>
      </div>

      <SubmitButton btnText="Send" />
    </form>
  );
};

export default PollForm;
