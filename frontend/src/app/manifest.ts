import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NexusChat",
    short_name: "NexusChat",
    theme_color: "#000000",
    background_color: "#000000",
    display: "standalone",
    display_override:['window-controls-overlay'],
    scope: "/",
    orientation:"any",
    id:"/",
    start_url: "/",
    icons: [
      {
        src: "images/pwa/maskable192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "images/pwa/logo192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "images/pwa/logo256.png",
        sizes: "256x256",
        type: "image/png",
      },
      {
        src: "images/pwa/logo384.png",
        sizes: "384x384",
        type: "image/png",
      },
      {
        src: "images/pwa/logo512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    screenshots:[
      // dekstop screenshots
      {
        src:"images/dekstop-screenshots/group-chat-creation.png",
        form_factor:"wide",
        label:"Create Groups",
        // sizes:"1920x1080",
        type:"image/png"
      },
      {
        src:"images/dekstop-screenshots/sending-gif.png",
        form_factor:"wide",
        label:"Send Gifs",
        // sizes:"1920x1080",
        type:"image/png"
      },
      {
        src:"images/dekstop-screenshots/poll-creation.png",
        form_factor:"wide",
        label:"Create Polls",
        // sizes:"1920x1080",
        type:"image/png"
      },
      {
        src:"images/dekstop-screenshots/uploading-attachments.png",
        form_factor:"wide",
        label:"Send photos, edit/unsend messages and many more..",
        // sizes:"1920x1080",
        type:"image/png"
      },

      // mobile screenshots
      {
        src:"images/mobile-screenshots/home-screen.png",
        form_factor:"narrow",
        label:"See all your chats in one place",
        // sizes:"1080x1920",
        type:"image/png"
      },
      {
        src:"images/mobile-screenshots/call-history.png",
        form_factor:"narrow",
        label:"See your call history",
        // sizes:"1080x1920",
        type:"image/png"
      },
      {
        src:"images/mobile-screenshots/incoming-call.png",
        form_factor:"narrow",
        label:"Incoming call popup",
        // sizes:"1080x1920",
        type:"image/png"
      },
      {
        src:"images/mobile-screenshots/ongoing-call.png",
        form_factor:"narrow",
        label:"Video/audio calls with friends",
        // sizes:"1080x1920",
        type:"image/png"
      },
      {
        src:"images/mobile-screenshots/chat-view.png",
        form_factor:"narrow",
        label:"Chat with friends",
        // sizes:"1080x1920",
        type:"image/png"
      },
      {
        src:"images/mobile-screenshots/reaction-and-unsend-feature.png",
        form_factor:"narrow",
        label:"React to messages and unsend messages",
        // sizes:"1080x1920",
        type:"image/png"
      },
      {
        src:"images/mobile-screenshots/add-caption-on-photo.png",
        form_factor:"narrow",
        label:"Add caption to photos",
        // sizes:"1080x1920",
        type:"image/png"
      },
      {
        src:"images/mobile-screenshots/chat-details.png",
        form_factor:"narrow",
        label:"Manage group chats",
        // sizes:"1080x1920",
        type:"image/png"
      },
    ],
  };
}
