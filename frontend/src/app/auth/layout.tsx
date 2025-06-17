import { AppBranding } from "@/components/shared/AppBranding";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex w-screen h-screen bg-background text-text max-xl:justify-center ">
      <div className="flex-auto flex justify-center items-center p-4 max-xl:hidden">
        <AppBranding />
      </div>

      <div className="w-[50rem] px-4 flex flex-col gap-y-14 shadow-xl my-10">
        {children}
      </div>
    </div>
  );
}
