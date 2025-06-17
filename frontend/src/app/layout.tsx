import { InitializeIndexedDbWrapper } from "@/components/auth/InitializeIndexedDbWrapper";
import { ModalWrapper } from "@/components/modal/ModalWrapper";
import { ThemeInitializer } from "@/components/theme/ThemeInitializer";
import { SocketProvider } from "@/context/socket.context";
import StoreProvider from "@/lib/client/store/StoreProvider";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";
import Head from "next/head";
import { Toaster as SonnerToaster} from "@/components/ui/Sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jsonLd = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "NexusChat",
      "url": "https://NexusChat.in",
      "author": {
        "@type": "Person",
        "name": "Elly Carlos",
        "url": "https://rishibakshii.github.io/portfolio"
      },
      "sameAs": [
        "https://github.com/RishiBakshii/nextjs-chat-app",
        "https://twitter.com/rishibakshii",
        "https://www.linkedin.com/in/rishi-bakshi/",
        "https://leetcode.com/u/rishibakshii/",
        "https://hashnode.com/@RishiBakshi",
        "https://rishibakshi.hashnode.dev/",
      ],
    "applicationCategory": "SocialNetworkingApplication",
    "operatingSystem": "All"
}

export const metadata:Metadata = {
   

  title: "NexusChat - Secure & Encrypted Chat App",
  description: "NexusChat is a privacy-first chat app offering end-to-end encryption for private chats and secure real-time messaging.",
  keywords: ["NexusChat","secure chat","end-to-end encryption","private messaging","chat app","encrypted chat app","secure messaging","privacy-focused chat","real-time chat","secure communication","instant messaging","chat application","E2EE messaging","secure group chats","encrypted conversations","safe messaging app"],
  generator:"Next.js",
  applicationName: "NexusChat",
  authors: [{ name: "Elly Carlos", url: "https://rishibakshii.github.io/portfolio" }],
  creator: "Elly Carlos",
  publisher: "Elly Carlos",
  metadataBase: new URL("https://NexusChat.in"),
  icons:{
    apple:{
      url:"https://NexusChat.in/images/apple-touch-icon/apple-touch-icon.png",
    },
  },
  

  openGraph: {
    title: "NexusChat - Secure & Encrypted Chat App",
    description: "NexusChat is a privacy-first chat app offering end-to-end encryption for private chats and secure real-time messaging.",
    url: "https://NexusChat.in",
    siteName: "NexusChat",
    images: [
      {
        url: "https://NexusChat.in/images/og/og-image.png", // Static path from public folder
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
    images: ["https://NexusChat.in/images/og/og-image.png"],
    creator:"@rishibakshii",
    site: "@rishibakshii",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://NexusChat.in",
  },
  other: {
    jsonLd: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "NexusChat",
      "url": "https://NexusChat.in",
      "author": {
        "@type": "Person",
        "name": "Elly Carlos",
        "url": "https://rishibakshii.github.io/portfolio"
      },
      "sameAs": [
        "https://github.com/RishiBakshii/nextjs-chat-app",
        "https://twitter.com/rishibakshii",
        "https://www.linkedin.com/in/rishi-bakshi/",
        "https://leetcode.com/u/rishibakshii/",
        "https://hashnode.com/@RishiBakshi",
        "https://rishibakshi.hashnode.dev/"
      ],
      "applicationCategory": "SocialNetworkingApplication",
      "operatingSystem": "All"
    })
  }
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
    <Head>
      <link rel="preload" href="https://NexusChat.in/images/og/og-image.png" as="image" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd)}}
      />
    </Head>
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Modal root for portals */}
        <div id="modal-root"></div>
        <StoreProvider>
          <SocketProvider>
            <Toaster />
            <SonnerToaster/>
            <InitializeIndexedDbWrapper />
            <ThemeInitializer />
            <ModalWrapper />
            {children}
          </SocketProvider>
        </StoreProvider>
      </body>
    </html>
    </>
  );
}
