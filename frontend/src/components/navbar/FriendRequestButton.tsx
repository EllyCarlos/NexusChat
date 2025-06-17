'use client';
import { useOpenFriendRequestForm } from "@/hooks/useUI/useOpenFriendRequestForm";
import { Badge } from "../ui/Badge";
import { FriendRequestIcon } from "../ui/icons/FriendRequestIcon";

type PropTypes = {
  numberOfFriendRequest: number;
};

export const FriendRequestButton = ({ numberOfFriendRequest }: PropTypes) => {
  const { openFriendRequestForm } = useOpenFriendRequestForm();
  return (
    <button onClick={openFriendRequestForm}>
      <div className="relative">
        <FriendRequestIcon />
        <Badge value={numberOfFriendRequest} />
      </div>
    </button>
  );
};
