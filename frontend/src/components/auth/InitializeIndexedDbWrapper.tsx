"use client";

import { initializeIndexDb } from "@/lib/client/indexedDB";
import { useEffect } from "react";

export const InitializeIndexedDbWrapper = () => {
  useEffect(() => {
    initializeIndexDb();
  }, []);
  return <></>;
};
