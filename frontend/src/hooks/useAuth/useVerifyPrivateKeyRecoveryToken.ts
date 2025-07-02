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
  // Add isPending to see when the action is running
  const [state,verifyPrivateKeyRecoveryTokenAction, isPending] = useActionState(verifyPrivateKeyRecoveryToken,undefined);


  const router = useRouter();
  
  const handleDecryptPrivateKey = useCallback(async ({combinedSecret,privateKey}:{privateKey?:string,combinedSecret?:string}) => {
    console.log('handleDecryptPrivateKey called. combinedSecret present:', !!combinedSecret, 'privateKey present:', !!privateKey);

  
  // 1. Log initial state and user load
  useEffect(() => {
    console.log('Hook initialized. recoveryToken:', recoveryToken);
    try {
      const userData = localStorage.getItem("loggedInUser");
      if (userData) {
        const parsedUser = JSON.parse(userData) as FetchUserInfoResponse;
        console.log('User data found in localStorage:', parsedUser);
        if (parsedUser) setLoggedInUser(parsedUser);
        else{
          toast.error("Some error occured (parsedUser is null)");
          router.push("/auth/login");
        }
      }
      else{
        console.log('No user data found in localStorage.');
        toast.error("Some error occured (no user in localStorage)");
        router.push("/auth/login");
      }
    }
    catch (error) {
      console.log('error getting loggedInUser from localStorage', error);
      toast.error("Some error occured (localStorage parse error)");
      router.push("/auth/login");
    }
  }, []);

  // 2. Log when server action is triggered
  useEffect(() => {
    if (loggedInUser && recoveryToken){
      console.log('Triggering verifyPrivateKeyRecoveryTokenAction with userId:', loggedInUser.id);
      startTransition(()=>{
        verifyPrivateKeyRecoveryTokenAction({recoveryToken,userId:loggedInUser.id});
      })
    } else {
        console.log('Waiting for loggedInUser or recoveryToken to trigger action. loggedInUser:', !!loggedInUser, 'recoveryToken:', !!recoveryToken);
    }
  }, [loggedInUser, recoveryToken, verifyPrivateKeyRecoveryTokenAction]); // Added verifyPrivateKeyRecoveryTokenAction to deps

  // 3. Log server action state changes
  useEffect(()=>{
    console.log('State updated:', state);
    if (isPending) {
        console.log('Server action is pending...');
    } else if((state?.data?.combinedSecret || state?.data?.privateKey)){
      console.log('Server action successful, setting isSuccess to true.');
      setIsSuccess(true);
    }
    else if(state?.errors?.message){ // Check for actual message content
      console.error('Server action error:', state.errors.message);
      toast.error(state.errors.message);
      router.push("/auth/login");
    }
  },[state, isPending, router]); // Added isPending and router to deps

  // 4. Log decryption and storage process
  useEffect(() => {
    if (isSuccess && loggedInUser && (state?.data?.combinedSecret || state?.data?.privateKey)) {
      console.log('Starting decryption and IndexedDB storage.');
      handleDecryptPrivateKey({combinedSecret:state?.data?.combinedSecret,privateKey:state?.data?.privateKey});
    } else {
        console.log('Waiting for isSuccess or loggedInUser or key data to decrypt.');
    }
  }, [isSuccess, loggedInUser, state?.data?.combinedSecret, state?.data?.privateKey, handleDecryptPrivateKey]);

  if ((privateKey || combinedSecret) && loggedInUser) {
      let password;

      if (combinedSecret) {
        password = combinedSecret;
        console.log('Using combinedSecret as password.');
      } else {
        const passInLocalStorage = localStorage.getItem("tempPassword");
        console.log('Checking for tempPassword in localStorage:', passInLocalStorage ? 'found' : 'not found');
        if (passInLocalStorage) {
          password = passInLocalStorage;
        } else {
          toast.error("Error: tempPassword missing from localStorage.");
          router.push("/auth/login");
          return; // Crucial: exit if password isn't found
        }
      }

      if (password) {
        try {
          console.log('Attempting to decrypt private key...');
          const privateKeyInJwk = await decryptPrivateKey(
            password,
            privateKey! // Still consider if ! is truly safe here
          );
          console.log('Private key decrypted. Storing in IndexedDB...');
          await storeUserPrivateKeyInIndexedDB({
            privateKey: privateKeyInJwk,
            userId: loggedInUser.id,
          });
          console.log('Private key stored in IndexedDB successfully.');

          // Crucial: Clear temporary data *after* successful storage
          localStorage.removeItem("tempPassword");
          localStorage.removeItem("loggedInUser");
          console.log('tempPassword and loggedInUser removed from localStorage.');

          setIsPrivateKeyRestoredInIndexedDB(true);
          console.log('setIsPrivateKeyRestoredInIndexedDB set to true.');
        } catch (decryptError) {
          console.error('Error during decryption or IndexedDB storage:', decryptError);
          toast.error("Error recovering private key during decryption/storage.");
          router.push("/auth/login");
        }
      }
      else {
        console.log('handleDecryptPrivateKey: No password found.');
        toast.error("Some error occured while recovering (no password).");
        router.push("/auth/login");
      }
    }
    else{
      console.log('handleDecryptPrivateKey: Missing privateKey/combinedSecret or loggedInUser.');
      toast.error("Some error occured while recovering (missing key data/user).");
      router.push("/auth/login");
    }
  },[loggedInUser, router]);

  console.log('Current return state: isPrivateKeyRestoredInIndexedDB:', isPrivateKeyRestoredInIndexedDB, 'isSuccess:', isSuccess);
  return {
    isPrivateKeyRestoredInIndexedDB: isPrivateKeyRestoredInIndexedDB && isSuccess,
  };
};
