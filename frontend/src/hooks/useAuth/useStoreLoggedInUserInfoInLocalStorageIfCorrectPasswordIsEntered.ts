import { User } from "@/interfaces/auth.interface";
import { useEffect } from "react";

type PropTypes = {
    isSuccess:boolean;
    loggedInUser: User | null;
}

export const useStoreLoggedInUserInfoInLocalStorageIfCorrectPasswordIsEntered = ({isSuccess,loggedInUser}:PropTypes) => {
  useEffect(()=>{
    if(isSuccess && loggedInUser){
      localStorage.setItem("loggedInUser",JSON.stringify(loggedInUser));
    }
  },[isSuccess,loggedInUser])
}
