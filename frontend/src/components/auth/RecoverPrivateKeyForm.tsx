"use client";
import { getPrivateKeyRecoveryOptions } from "@/actions/auth.actions";
import { useLogout } from "@/hooks/useAuth/useLogout";
import type { PrivateKeyRecoveryOptions } from "@/interfaces/auth.interface";
import { getPrivateKeyRecoveryPresentation } from "@/lib/client/privateKeyRecoveryPresentation";
import { useEffect, useState } from "react";
import { LogoutIcon } from "../ui/icons/LogoutIcon";
import { RecoveryOptionsForManualSignedUpUser } from "./RecoveryOptionsForManualSignedUpUser";
import { RecoveryOptionsForOAuthSignedUpUser } from "./RecoveryOptionsForOAuthSignedUpUser";

const RecoverPrivateKeyForm = () => {
  const handleLogoutClick = useLogout();
  const [recoveryOptions, setRecoveryOptions] =
    useState<PrivateKeyRecoveryOptions | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getPrivateKeyRecoveryOptions()
      .then((result) => {
        if (!active) return;
        if (result.data) {
          setRecoveryOptions(result.data);
          return;
        }
        setRecoveryError(result.errors.message);
      })
      .catch(() => {
        if (active) {
          setRecoveryError("Private-key recovery is unavailable.");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const presentation = recoveryOptions
    ? getPrivateKeyRecoveryPresentation(recoveryOptions)
    : null;

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
        {presentation && <p>{presentation.copy}</p>}
        {!presentation && !recoveryError && <p>Loading recovery options…</p>}
        {recoveryError && <p>{recoveryError}</p>}
      </div>
      {presentation?.recoveryKind === "oauth" ? (
        <RecoveryOptionsForOAuthSignedUpUser />
      ) : presentation?.recoveryKind === "manual" ? (
        <RecoveryOptionsForManualSignedUpUser />
      ) : null}
    </div>
  );
};

export default RecoverPrivateKeyForm;
