"use client";
import { useGetUserFriendRequestsQuery } from "@/lib/client/rtk-query/request.api";
import { AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useToggleChatBar } from "../../hooks/useUI/useToggleChatBar";
import { useToggleNavMenu } from "../../hooks/useUI/useToggleNavMenu";
import { selectLoggedInUser } from "../../lib/client/slices/authSlice";
import { selectNavMenu } from "../../lib/client/slices/uiSlice";
import { useAppSelector } from "../../lib/client/store/hooks";
import { HamburgerIcon } from "../ui/icons/HamburgerIcon";
import { FriendRequestButton } from "./FriendRequestButton";
import { NavMenu } from "./NavMenu";
import { ToggleThemeButton } from "./ToggleThemeButton";
import { User } from "@/interfaces/auth.interface";
import { DEFAULT_AVATAR } from "@/constants";
import { GithubIcon } from "../ui/icons/GithubIcon";

export const Navbar = () => {
  const { data: friendRequests } = useGetUserFriendRequestsQuery();
  const isNavMenuOpen = useAppSelector(selectNavMenu);
  const toggleNavMenu = useToggleNavMenu();
  const { toggleChatBar } = useToggleChatBar();
  const loggedInUser = useAppSelector(selectLoggedInUser) as User;

  return (
    <nav className="flex items-center h-14 justify-around shadow bg-background text-text select-none">
      <button onClick={toggleChatBar} className="hidden max-lg:block">
        <HamburgerIcon />
      </button>

      <div className="flex items-center gap-x-2 justify-center">
        <h4 className="text-3xl font-Shantell-Sans font-medium max-sm:text-xl">
          Nexus Chat
        </h4>
        <a href="https://github.com/EllyCarlos/NexusChat" target="_blank">
          <GithubIcon/>
        </a>
      </div>

      <div className="flex item-center gap-x-10">
        {friendRequests && friendRequests.length > 0 && (
          <FriendRequestButton
            numberOfFriendRequest={friendRequests ? friendRequests.length : 0}
          />
        )}
        <ToggleThemeButton />

        {loggedInUser && (
          <div className="relative shrink-0">
            <Image
              onClick={toggleNavMenu}
              src={loggedInUser?.avatar || DEFAULT_AVATAR}
              width={100}
              height={100}
              alt={`${loggedInUser?.username} avatar`}
              className="size-10 rounded-full object-cover shrink-0"
            />
            <AnimatePresence>{isNavMenuOpen && <NavMenu />}</AnimatePresence>
          </div>
        )}
      </div>
    </nav>
  );
};
