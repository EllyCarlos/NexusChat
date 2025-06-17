import Image from "next/image";

type PropTypes = {
  url: string;
};

export const Gif = ({ url }: PropTypes) => {
  return (
    <div className="h-96 max-xl:h-80 ">
      <Image unoptimized className="w-full h-full object-contain" width={10} height={10} src={url} alt="gif" />
    </div>
  );
};
