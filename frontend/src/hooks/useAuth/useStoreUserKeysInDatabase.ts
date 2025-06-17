import { storeUserKeysInDatabase } from "@/actions/auth.actions";
import { startTransition, useActionState, useEffect } from "react";

type PropTypes = {
    encryptedPrivateKey: string | null;
    publicKeyJWK: JsonWebKey | null;
    loggedInUserId:string | undefined;
}

export const useStoreUserKeysInDatabase = ({encryptedPrivateKey,publicKeyJWK,loggedInUserId}:PropTypes) => {

    const [state,storeUserKeysInDatabaseAction] = useActionState(storeUserKeysInDatabase,undefined);

    useEffect(()=>{
        if(encryptedPrivateKey && publicKeyJWK && loggedInUserId){
            startTransition(()=>{
                storeUserKeysInDatabaseAction({privateKey:encryptedPrivateKey,loggedInUserId,publicKey:publicKeyJWK})
            })
        }
    },[encryptedPrivateKey, publicKeyJWK,loggedInUserId]);

    return {
        publicKeyReturnedFromServerAfterBeingStored:state?.data?.publicKey
    }

}
