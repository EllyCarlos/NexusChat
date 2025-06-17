import { verifyPrivateKeyRecoveryToken } from "@/actions/auth.actions";
import { storeUserPrivateKeyInIndexedDB } from "@/lib/client/indexedDB";
import { FetchUserInfoResponse } from "@/lib/server/services/userService";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { decryptPrivateKey } from "../../lib/client/encryption";

type PropTypes = {
  recoveryToken: string | null;
};

export const useVerifyPrivateKeyRecoveryToken = ({recoveryToken}: PropTypes) => {

  const [isPrivateKeyRestoredInIndexedDB, setIsPrivateKeyRestoredInIndexedDB] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<FetchUserInfoResponse>();
  const [isSuccess,setIsSuccess] = useState<boolean>(false);
  const [state,verifyPrivateKeyRecoveryTokenAction] = useActionState(verifyPrivateKeyRecoveryToken,undefined);


  const router = useRouter();

  useEffect(() => {
    try {
      const userData = localStorage.getItem("loggedInUser");
      if (userData) {
        const loggedInUser = JSON.parse(userData) as FetchUserInfoResponse;
        if (loggedInUser) setLoggedInUser(loggedInUser);
        else{
          toast.error("Some error occured");
          router.push("/auth/login");
        }
      }
      else{
        toast.error("Some error occured");
        router.push("/auth/login");
      }
    }
    catch (error) {
      console.log('error getting loggedInUser from localStorage', error);
      toast.error("Some error occured");
      router.push("/auth/login");
    }
  }, []);
  
  useEffect(() => {
    if (loggedInUser && recoveryToken){
      startTransition(()=>{
        verifyPrivateKeyRecoveryTokenAction({recoveryToken,userId:loggedInUser.id});
      })
    }
  }, [loggedInUser]);

  useEffect(()=>{
    if((state?.data?.combinedSecret || state?.data?.privateKey)){
      setIsSuccess(true);
    }
    else if(state?.errors.message?.length){
      toast.error(state?.errors.message);
      router.push("/auth/login");
    }
  },[state])

  useEffect(() => {
    if (isSuccess && loggedInUser) {
      handleDecryptPrivateKey({combinedSecret:state?.data?.combinedSecret,privateKey:state?.data?.privateKey});
    }
  }, [isSuccess]);



  const handleDecryptPrivateKey = useCallback(async ({combinedSecret,privateKey}:{privateKey?:string,combinedSecret?:string}) => {

    if ((privateKey || combinedSecret) && loggedInUser) {

      let password;

      if (combinedSecret) {
        // as for oAuth signed up users there is no password so we use combinedSecret as their password which is a combo of
        // googleId + someSecretValue(stored on server)
        // so basically
        // combinedSecret = googleId + someSecretValue(stored on server)
        // and this combined secret is being used as their password
        password = combinedSecret;
      } else {
        // if combined secret did not came
        // then it means that user has signed up manually
        // so we will use their password
        const passInLocalStorage = localStorage.getItem("tempPassword");

        if (passInLocalStorage) {
          password = passInLocalStorage;
        } else {
          toast.error("Some error occured");
          router.push("/auth/login");
        }
      }

      if (password) {
        // now as we have the password of user
        // we will decrypt the privateKey using this password (as the privateKey was also encrypted using this password)
        const privateKeyInJwk = await decryptPrivateKey(
          password,
          privateKey!
        );
        // and then we will store the decrypted privateKey in indexedDB
        await storeUserPrivateKeyInIndexedDB({
          privateKey: privateKeyInJwk,
          userId: loggedInUser.id,
        });

        // and then we will remove the tempPassword and loggedInUser from localStorage
        localStorage.removeItem("tempPassword");
        localStorage.removeItem("loggedInUser");
        setIsPrivateKeyRestoredInIndexedDB(true);
      }
      else {
        toast.error("Some error occured while recovering");
        router.push("/auth/login");
      }
    }
    else{
      toast.error("Some error occured while recovering");
      router.push("/auth/login");
    }
  },[loggedInUser]);

  return {
    isPrivateKeyRestoredInIndexedDB: isPrivateKeyRestoredInIndexedDB && isSuccess,
  };
};
