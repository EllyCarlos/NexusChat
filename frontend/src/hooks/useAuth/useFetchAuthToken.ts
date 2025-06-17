"use client";

import { getAuthToken } from "@/actions/auth.actions";
import { setAuthToken } from "@/lib/client/slices/authSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useEffect } from "react";


export const useFetchAuthToken = () => {

  const dispatch = useAppDispatch();

  useEffect(() => {
    async function fetchToken() {
      const token = await getAuthToken();
      if (token) dispatch(setAuthToken(token));
    }
    fetchToken();
  }, [dispatch]);

};
