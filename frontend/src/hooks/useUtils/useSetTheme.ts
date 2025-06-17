import type { Theme } from "@/interfaces/theme.interface";
import { useEffect } from "react";
import { useUpdateTheme } from "./useUpdateTheme";

export const useSetTheme = () => {

    const {updateTheme} = useUpdateTheme()

    useEffect(()=>{

        const localTheme = localStorage.getItem('theme') as Theme;
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
        if (localTheme==='dark' || localTheme === 'light') {
            updateTheme(localTheme)
        }
        else{
            updateTheme(systemPrefersDark ? 'dark' : 'light');
        }
    },[updateTheme])

}
