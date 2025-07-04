import { Navbar } from "@/components/navbar/Navbar";
import { MessageInputProvider } from "@/context/message-input-ref.context";
import { Metadata } from "next";

export const metadata:Metadata = {
   

  title: "NexusChat - Secure & Encrypted Chat App",
  description: "NexusChat is a privacy-first chat app offering end-to-end encryption for private chats and secure real-time messaging.",
  keywords: ["NexusChat","secure chat","end-to-end encryption","private messaging","chat app","encrypted chat app","secure messaging","privacy-focused chat","real-time chat","secure communication","instant messaging","chat application","E2EE messaging","secure group chats","encrypted conversations","safe messaging app"],
  generator:"Next.js",
  applicationName: "NexusChat",
  authors: [{ name: "Elly Carlos", url: "ellycarlos.vercel.app" }],
  creator: "Elly Carlos",
  publisher: "Elly Carlos",
  metadataBase: new URL("https://nexuswebapp.vercel.app"),

  openGraph: {
    title: "NexusChat - Secure & Encrypted Chat App",
    description: "NexusChat is a privacy-first chat app offering end-to-end encryption for private chats and secure real-time messaging.",
    url: "https://nexuswebapp.vercel.app",
    siteName: "NexusChat",
    images: [
      {
        url: "https://nexuswebapp.vercel.app/images/og/og-image.png", // Static path from public folder
        width: 1200,
        height: 630,
        alt: "NexusChat - Secure & Encrypted Chat App",
      },
    ],
    type: "website",
    locale: "en_US", // Helps in localization
  },
  twitter: {
    card: "summary_large_image",
    title: "NexusChat - Secure & Encrypted Chat App",
    description: "NexusChat is a privacy-first chat app offering end-to-end encryption for private chats and secure real-time messaging.",
    images: ["https://nexuswebapp.vercel.app/images/og/og-image.png"],
    creator:"@ellycarlos",
    site: "@ellycarlos",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://nexuswebapp.vercel.app",
  },
};

export default function ChatLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <header>
        <Navbar />
      </header>
      <main className="h-[calc(100vh-3.5rem)]">
        <MessageInputProvider>
          {children}
        </MessageInputProvider>
      </main>
    </>
  );
}
