"use client";
import Lottie from "lottie-react";
import { useSyncExternalStore } from "react";

type PropTypes = {
  animationData: unknown;
};

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export const LottieAnimation = ({ animationData }: PropTypes) => {
  const isClient = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot
  );
  return isClient && <Lottie loop={false} animationData={animationData} />;
};
