import { User } from "@/interfaces/auth.interface";
import { useEffect } from "react";

type PropTypes = {
    isPrivateKeyRecoveryEmailSentSuccessful: boolean;
    loggedInUser: User;
}

export const useStoreLoggedInUserInfoInLocalStorageIfRecoveryEmailSentSuccessful = ({isPrivateKeyRecoveryEmailSentSuccessful,loggedInUser}:PropTypes) => {
  useEffect(()=>{
    if(isPrivateKeyRecoveryEmailSentSuccessful){
      localStorage.setItem("loggedInUser",JSON.stringify(loggedInUser));
    }
  },[isPrivateKeyRecoveryEmailSentSuccessful])
}
