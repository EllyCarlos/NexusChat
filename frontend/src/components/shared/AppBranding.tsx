import { APP_BRANDING_PROFILE_IMAGES } from "@/constants";
import Image from "next/image";

export const AppBranding = () => {
  return (
    <div className="text-inherit bg-inherit flex flex-col gap-y-2">
      <div className="flex flex-col gap-y-1">
        <div className="flex items-center gap-x-4">
          <h1 className="text-7xl font-bold">Nexus Chat</h1>
        </div>
        <h2 className="text-2xl font-semibold">
          Discover your next conversation
        </h2>
      </div>

      <p className="text-white-500 text-lg">
        Join our vibrant community and build
        connections that last forever
      </p>
      <div className="flex gap-x-1">
        {APP_BRANDING_PROFILE_IMAGES.map((avatar, index) => (
          <Image
            key={index}
            width={200}
            height={200}
            quality={100}
            src={avatar}
            className="size-16 rounded-full object-cover shrink-0"
            alt="avatar"
          />
        ))}
      </div>
    </div>
  );
};
