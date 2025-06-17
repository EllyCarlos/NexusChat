import { useFormStatus } from "react-dom";
import { CircleLoading } from "../shared/CircleLoading";

type PropTypes = {
  btnText: string;
  disabled?: boolean;
  isLoading?: boolean;
};

export const SubmitButton = ({ btnText, isLoading }: PropTypes) => {
  const { pending } = useFormStatus();

  return (
    <button
      disabled={pending}
      type="submit"
      className={`w-full ${
        isLoading ? "bg-background" : "bg-primary"
      } text-white px-6 py-3 rounded shadow-lg font-medium text-center flex justify-center`}
    >
      {pending ? <CircleLoading size="6" /> : btnText}
    </button>
  );
};
