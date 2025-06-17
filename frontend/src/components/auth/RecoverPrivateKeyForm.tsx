"use client";
import { logout } from "@/actions/auth.actions";
import { useRouter } from "next/navigation";
import { selectLoggedInUser } from "../../lib/client/slices/authSlice";
import { useAppSelector } from "../../lib/client/store/hooks";
import { LogoutIcon } from "../ui/icons/LogoutIcon";
import { RecoveryOptionsForManualSignedUpUser } from "./RecoveryOptionsForManualSignedUpUser";
import { RecoveryOptionsForOAuthSignedUpUser } from "./RecoveryOptionsForOAuthSignedUpUser";

const RecoverPrivateKeyForm = () => {
  const loggedInUser = useAppSelector(selectLoggedInUser);
  const hasUserSignedUpViaOAuth = loggedInUser?.oAuthSignup;

  const router = useRouter();

  const handleLogoutClick = async() => {
    await logout();
    router.push("/auth/login")
  };

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-4">
        <div className="flex items-center justify-between flex-wrap gap-y-2">
          <h2 className="text-xl font-bold mr-5">Recover Your Private Key</h2>
          <button
            type="button"
            onClick={handleLogoutClick}
            className="flex items-center gap-x-1"
          >
            <span>Logout instead</span>
            <LogoutIcon />
          </button>
        </div>
        {loggedInUser?.oAuthSignup ? (
          <p>
            It looks like we&apos;ve detected that your private key is missing.
            Don&apos;t worry, you can easily recover it by verifying your email.
            Simply click the button below to initiate the recovery process. You
            will receive a verification email shortly. Please click on the
            verify button in that email. Once verified, we will restore your
            private key, and you&apos;ll be back to normal in no time.
          </p>
        ) : (
          <p>
            It looks like we&apos;ve detected that your private key is missing.
            Don&apos;t worry, you can easily recover it by entering your account
            password. After entering your correct password, you will receive a
            verification email. Please click on the verify button in that email.
            Once verified, we will restore your private key, and you&apos;ll be
            back to normal in no time.
          </p>
        )}
      </div>
      {hasUserSignedUpViaOAuth ? (
        <RecoveryOptionsForOAuthSignedUpUser loggedInUser={loggedInUser} />
      ) : (
        <RecoveryOptionsForManualSignedUpUser loggedInUser={loggedInUser} />
      )}
    </div>
  );
};

export default RecoverPrivateKeyForm;
