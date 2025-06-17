import { useToggleAddMemberForm } from "@/hooks/useUI/useToggleAddMemberForm";
import { AddMemberIcon } from "../ui/icons/AddMemberIcon";

export const AddMemberOption = () => {
  
  const {toggleAddMemberForm} = useToggleAddMemberForm();

  return (
    <div className="flex items-center justify-between">
      <p>Add member</p>
      <button
        onClick={toggleAddMemberForm}
        className="w-8 h-8 flex justify-center items-center rounded-full text-white"
      >
        <AddMemberIcon/>
      </button>
    </div>
  );
};
