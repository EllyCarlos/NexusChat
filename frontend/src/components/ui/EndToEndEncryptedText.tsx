import { LockIcon } from "./icons/LockIcon";

export const EndToEndEncryptedText = () => {
  return (
    <div className="flex items-center gap-x-1">
      <p className="text-secondary-darker">End to end encrypted</p>
      <LockIcon />
    </div>
  );
};
