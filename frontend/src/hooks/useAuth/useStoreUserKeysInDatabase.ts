import { storeUserKeysInDatabase } from "@/actions/auth.actions";
import { startTransition, useActionState, useEffect } from "react";

type PropTypes = {
    encryptedPrivateKey: string | null;
    publicKeyJWK: JsonWebKey | null;
    shouldStoreKeys: boolean;
}

export const useStoreUserKeysInDatabase = ({encryptedPrivateKey,publicKeyJWK,shouldStoreKeys}:PropTypes) => {

    const [state,storeUserKeysInDatabaseAction] = useActionState(storeUserKeysInDatabase,undefined);

    useEffect(()=>{
        if(encryptedPrivateKey && publicKeyJWK && shouldStoreKeys){
            startTransition(()=>{
                storeUserKeysInDatabaseAction({privateKey:encryptedPrivateKey,publicKey:publicKeyJWK})
            })
        }
    },[encryptedPrivateKey, publicKeyJWK,shouldStoreKeys]);

    return {
        publicKeyReturnedFromServerAfterBeingStored:state?.data?.publicKey
    }

}
