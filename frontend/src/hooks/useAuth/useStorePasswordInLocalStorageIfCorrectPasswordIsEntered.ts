import { useEffect } from "react";

type PropTypes = {
    passwordRef:string;
    isSuccess:boolean;
}

export const useStorePasswordInLocalStorageIfCorrectPasswordIsEntered = ({isSuccess,passwordRef}:PropTypes) => {
  useEffect(()=>{
    if(isSuccess){
      localStorage.setItem("tempPassword",passwordRef);
    }
  },[isSuccess])
}
