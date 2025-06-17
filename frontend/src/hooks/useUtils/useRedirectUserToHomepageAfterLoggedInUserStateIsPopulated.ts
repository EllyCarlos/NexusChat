import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const useRedirectUserToHomepageAfterLoggedInUserStateIsPopulated =
  () => {
    const loggedInUser = useAppSelector(selectLoggedInUser);
    const router = useRouter();

    useEffect(() => {
      if (loggedInUser) {
        router.push("/");
      }
    }, [loggedInUser, router]);
  };
