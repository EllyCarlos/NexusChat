"use client";
import { FetchUserInfoResponse } from "@/lib/server/services/userService";
import { useEffect } from "react";
import { updateLoggedInUser } from "../../lib/client/slices/authSlice";
import { useAppDispatch } from "../../lib/client/store/hooks";

type PropTypes = {
  isSuccess: boolean;
  user: FetchUserInfoResponse | null | undefined;
};

export const useUpdateLoggedInUserState = ({ user, isSuccess }: PropTypes) => {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (isSuccess && user) {
      dispatch(updateLoggedInUser(user));
    }
  }, [dispatch, isSuccess, user]);
};
