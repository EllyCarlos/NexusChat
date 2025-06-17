import { useUpdateProfileMutation } from "@/lib/client/rtk-query/user.api";
import Image from "next/image";
import { useEffect, useState } from "react";
import { ACCEPTED_IMAGE_TYPES, DEFAULT_AVATAR } from "../../constants";
import { useToast } from "../../hooks/useUI/useToast";
import { selectLoggedInUser } from "../../lib/client/slices/authSlice";
import { useAppSelector } from "../../lib/client/store/hooks";
import { formatRelativeTime } from "../../lib/shared/helpers";
import { VerificationBadgeIcon } from "../ui/icons/VerificationBadgeIcon";

export const ProfileForm = () => {

  const loggedInUser = useAppSelector(selectLoggedInUser);

  const [updateProfileTrigger,{ error, isError, isLoading, isSuccess, isUninitialized }] = useUpdateProfileMutation();
  useToast({error,isError,isLoading,isSuccess,isUninitialized,loaderToast: true,successMessage: "Profile Updated",successToast: true,loadingMessage:"Updating Profile"});

  const [preview, setPreview] = useState<string>(loggedInUser?.avatar || DEFAULT_AVATAR);
  const [image, setImage] = useState<Blob>();
  const [editActive, setEditActive] = useState<boolean>(false);

  useEffect(() => {
    if (preview !== loggedInUser?.avatar) {
      setEditActive(true);
    }
  }, [preview]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length && e.target.files[0]) {
      const image = e.target.files[0];
      setPreview(URL.createObjectURL(image));
      setImage(image);
    }
  };

  const handleUpdateProfile = () => {
    if (image) {
      updateProfileTrigger({ avatar: image });
      setEditActive(false);
    }
  };

  return (
    <div>
      {loggedInUser ? (
        <div className="flex flex-col items-center gap-y-4 justify-center">
          <div className="flex flex-col items-center gap-y-4">
            <div className="w-40 h-40 rounded-full relative overflow-hidden">
              <input
                accept={ACCEPTED_IMAGE_TYPES.join(", ")}
                onChange={handleImageChange}
                className="absolute h-full w-full cursor-pointer opacity-0"
                type="file"
              />
              <Image
                width={500}
                height={500}
                quality={100}
                className="w-full h-full object-cover rounded-full"
                src={preview}
                alt={`${loggedInUser?.name} avatar`}
              />
            </div>

            <div className="flex flex-col items-center">
              <div className="flex items-center gap-x-1">
                <h4 className="font-medium text-xl">{loggedInUser.username}</h4>
                {loggedInUser.verificationBadge && (
                  <VerificationBadgeIcon/>
                )}
              </div>
              <p>{loggedInUser?.email}</p>
            </div>
          </div>

          <p>
            Joined{" "}
            {formatRelativeTime(
              JSON.stringify(new Date(loggedInUser.createdAt))
            )}
          </p>

          {editActive && (
            <button
              onClick={handleUpdateProfile}
              className="px-6 mt-2 py-2 bg-primary hover:bg-primary-dark rounded shadow-lg text-white"
            >
              Update profile
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default ProfileForm;
