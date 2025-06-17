"use client";
import Lottie from "lottie-react";
import { useEffect, useState } from "react";

type PropTypes = {
  animationData: unknown;
};

export const LottieAnimation = ({ animationData }: PropTypes) => {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);
  return isClient && <Lottie loop={false} animationData={animationData} />;
};
