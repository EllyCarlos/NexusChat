import { useRouter } from "next/navigation";
import { useEffect } from "react"

type PropTypes = {
    isPrivateKeyRestoredInIndexedDB:boolean;
}

export default function useNavigateToRecoverySuccessfulPageOnPrivateKeyRestoration({isPrivateKeyRestoredInIndexedDB}:PropTypes) {

    const router = useRouter();

    useEffect(()=>{
        if(isPrivateKeyRestoredInIndexedDB){
            router.push("/auth/private-key-restoration-success")
        }
    },[isPrivateKeyRestoredInIndexedDB])
}
