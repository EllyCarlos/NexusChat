'use client';
import { verifyOAuthToken } from '@/actions/auth.actions';
import { useConvertPrivateAndPublicKeyInJwkFormat } from '@/hooks/useAuth/useConvertPrivateAndPublicKeyInJwkFormat';
import { useEncryptPrivateKeyWithUserPassword } from '@/hooks/useAuth/useEncryptPrivateKeyWithUserPassword';
import { useGenerateKeyPair } from '@/hooks/useAuth/useGenerateKeyPair';
import { useStoreUserKeysInDatabase } from '@/hooks/useAuth/useStoreUserKeysInDatabase';
import { useStoreUserPrivateKeyInIndexedDB } from '@/hooks/useAuth/useStoreUserPrivateKeyInIndexedDB';
import { useUpdateLoggedInUserPublicKeyInState } from '@/hooks/useAuth/useUpdateLoggedInUserPublicKeyInState';
import { useRouter, useSearchParams } from 'next/navigation';

import { startTransition, Suspense, useActionState, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

function OAuthRedirectPageContent(){

  const [state,verifyOAuthTokenAction] =  useActionState(verifyOAuthToken,undefined);

  const searchParams = useSearchParams()
  const token = searchParams.get('token');
  
  const [isOAuthNewUser,setOAuthNewUser] = useState<boolean>(false);

  const router = useRouter();

  useEffect(()=>{
    if(token){
      startTransition(()=>{verifyOAuthTokenAction(token)});
    }
  },[token])

  useEffect(()=>{
    if(state?.data?.combinedSecret || state?.data?.user){
      // basically oAuth users dont have a password
      // so whenever any user registers via OAuth (i.e make a new account via OAuth)
      // so like the normal flow we need to generate their key pairs and store them in database
      // but in normal flow we encrypt the user private key with their password and then store it in database
      // but in OAuth flow we dont have a password for the user, so we use a "combinedSecret" which is a combination of their googleId and a secret
      // so we use this "combinedSecret" as their password to encrypt their private key and then store it in database

      // so basically for this OAuth flow we only need to generate keys for that user if combinedSecret is sent to us
      // as combinedSecret is only sent by the server when the user is a new user
      if(state.data.combinedSecret){
        toast.success("User signup successful");
        setOAuthNewUser(true);
      }
      else{
        toast.success("Welcome Back");
        router.push("/");
      }
    }
  },[state])


  // as discussed above, we are using the "combinedSecret" as the password to encrypt the private key for OAuth users
  const password  = state?.data?.combinedSecret;

  // and this generate key pair for the user will be called only if the user is a new user
  // and rest of all the flow is dependent on this "useGenerateKeyPair" hook
  

  // so if "isOAuthNewUser is false", then the keys will not be generated and the rest of the flow will not be executed
  const {privateKey,publicKey} = useGenerateKeyPair({user:isOAuthNewUser});
  const {privateKeyJWK,publicKeyJWK} = useConvertPrivateAndPublicKeyInJwkFormat({privateKey,publicKey});
  const {encryptedPrivateKey} = useEncryptPrivateKeyWithUserPassword({password,privateKeyJWK});
  const {publicKeyReturnedFromServerAfterBeingStored} = useStoreUserKeysInDatabase({encryptedPrivateKey,publicKeyJWK,loggedInUserId:state?.data?.user.id});
  useStoreUserPrivateKeyInIndexedDB({privateKey:privateKeyJWK,userId:state?.data?.user.id});
  useUpdateLoggedInUserPublicKeyInState({publicKey:publicKeyReturnedFromServerAfterBeingStored})
  
  return (
    <div className="bg-background w-full h-full text-text text-xl">Redirecting please wait...</div>
  )
}

export default function Page(){
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OAuthRedirectPageContent/>
    </Suspense>
  )
}
