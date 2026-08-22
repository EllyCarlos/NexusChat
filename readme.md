<div align="center">

# 💬 NexusChat

### Real-time Secure Messaging — Reimagined

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=nextdotjs)](https://nextjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-99.5%25-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?style=flat-square&logo=socketdotio)](https://socket.io/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)

**[🚀 Live Demo](https://nexuswebapp.vercel.app)** · **[🐛 Report Bug](https://github.com/EllyCarlos/NexusChat/issues)** · **[✨ Request Feature](https://github.com/EllyCarlos/NexusChat/issues)**

</div>

---

## 📖 Overview

**NexusChat** is a full-stack, real-time messaging application built for secure and fluid communication. From private one-on-one conversations and group chats to voice notes, file sharing, live calling, polls, and push notifications — NexusChat delivers a feature-complete modern chat experience.

Built with a **Next.js 15 + React 19** frontend and a **Node.js + Express + Socket.IO** backend, all wired together with **Prisma ORM** and **PostgreSQL**, and deployed on Vercel + Render.

---

## ✨ Features

| Category | Features |
|---|---|
| 💬 **Messaging** | One-on-one chats, group chats, real-time delivery, message history |
| 📎 **Media** | File sharing, image attachments, voice notes, emoji & GIF pickers |
| 📞 **Calling** | Real-time voice and video calling |
| 🔔 **Notifications** | Push notifications via Firebase Cloud Messaging |
| 🔐 **Authentication** | Email/password sign-up, JWT sessions, Google OAuth, MFA, password recovery |
| 📊 **Interactivity** | In-chat polls, animated UI, responsive design |
| 🛡️ **Security** | Helmet headers, bcrypt password hashing, secure token handling with `jose` |
| ☁️ **Storage** | Cloud media management via Cloudinary |

---

## 🛠️ Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **Next.js 15 + React 19** | Full-stack React framework |
| **Redux Toolkit + React-Redux** | Global state management |
| **React Hook Form + Zod** | Form handling & schema validation |
| **Socket.IO Client** | Real-time bidirectional communication |
| **Firebase (Client SDK)** | Push notifications |
| **Framer Motion + Lottie React** | Animations & UI effects |
| **Tailwind CSS** | Utility-first styling |
| **Emoji Picker + GIF Picker** | Rich in-chat media |
| **date-fns** | Date/time utilities |

### Backend
| Technology | Purpose |
|---|---|
| **Node.js + Express** | REST API server |
| **Socket.IO** | Real-time event-driven communication |
| **Prisma ORM + PostgreSQL** | Type-safe database access |
| **JWT + bcryptjs + jose** | Auth, password hashing & token encryption |
| **Passport.js + Google OAuth** | Social login (OAuth 2.0) |
| **Cloudinary** | Cloud image/file storage |
| **Nodemailer** | Email delivery (password reset, MFA) |
| **Firebase Admin SDK** | Server-side push notifications |
| **Helmet + CORS** | Security headers & cross-origin config |
| **Multer** | File upload handling |
| **Morgan** | HTTP request logging |

---

## 📁 Project Structure

```
NexusChat/
├── frontend/          # Next.js 15 application
│   ├── app/           # App Router pages & layouts
│   ├── components/    # Reusable UI components
│   ├── store/         # Redux Toolkit slices
│   └── ...
├── backend/           # Node.js + Express API
│   ├── prisma/        # Prisma schema & migrations
│   ├── routes/        # Express route handlers
│   ├── controllers/   # Business logic
│   ├── middleware/    # Auth, upload, logging
│   └── ...
├── .gitignore
├── LICENSE
└── README.md
```

---

## ⚙️ Local Setup

### Prerequisites

- **Node.js** 24.x
- **npm** or **Yarn**
- **Git**
- **PostgreSQL** database (local or hosted — [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Render](https://render.com) all work well)
- [**Firebase Project**](https://console.firebase.google.com/) (for push notifications)
- [**Cloudinary Account**](https://cloudinary.com/) (for file/image storage)
- [**Google OAuth Credentials**](https://console.cloud.google.com/) (for social login)

---

### 1. Clone the Repository

```bash
git clone https://github.com/EllyCarlos/NexusChat.git
cd NexusChat
```

---

### 2. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in the `backend/` directory:

```env
# ─── Database ────────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DB_NAME?schema=public"

# ─── JWT ─────────────────────────────────────────────────────────────────────
JWT_SECRET="your-strong-secret-key"

# ─── Cloudinary ──────────────────────────────────────────────────────────────
CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY="your-api-key"
CLOUDINARY_API_SECRET="your-api-secret"

# ─── Nodemailer ──────────────────────────────────────────────────────────────
NODEMAILER_USER="your-email@example.com"
NODEMAILER_PASS="your-email-password-or-app-password"

# ─── Google OAuth ────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_AUTH_REDIRECT_URI="http://localhost:3000/auth/oauth-redirect"

# ─── Firebase Admin ──────────────────────────────────────────────────────────
FIREBASE_ADMIN_SDK_PATH="./path/to/firebase-admin-sdk.json"

# ─── App ─────────────────────────────────────────────────────────────────────
VERCEL_FRONTEND_URL="http://localhost:3000"
NODE_ENV="DEVELOPMENT"
```

> ⚠️ **Never commit your `.env` file.** It's already in `.gitignore`.

Run database migrations and start the server:

```bash
npx prisma migrate dev --name init
npm run dev
```

The backend will be available at `http://localhost:5000`.

---

### 3. Frontend Setup

```bash
cd ../frontend
npm install
```

Create a `.env.local` file in the `frontend/` directory:

```env
# ─── Backend ─────────────────────────────────────────────────────────────────
NEXT_PUBLIC_BACKEND_URL="http://localhost:5000"
NEXT_PUBLIC_SOCKET_SERVER_URL="http://localhost:5000"

# ─── Firebase ────────────────────────────────────────────────────────────────
NEXT_PUBLIC_FIREBASE_API_KEY="your-firebase-api-key"
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="your-project-id"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="your-project.appspot.com"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="your-sender-id"
NEXT_PUBLIC_FIREBASE_APP_ID="your-app-id"
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID="G-XXXXXXXXXX"

# ─── Cloudinary ──────────────────────────────────────────────────────────────
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME="your-cloud-name"
```

Start the development server:

```bash
npm run dev
```

The frontend will be available at `http://localhost:3000`.

---

## 🚀 Deployment

NexusChat is designed to deploy on **Vercel** (frontend) and **Render** (backend + database).

### Backend → Render

1. Create a **PostgreSQL** service on Render and copy the **Internal Database URL**.
2. Create a **Web Service**, connect your GitHub repo, and set:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Pre-deploy Command:** `npx prisma migrate deploy`
3. Add all backend environment variables. Set `DATABASE_URL` to the internal DB URL and update `VERCEL_FRONTEND_URL` to your Vercel domain. Set `NODE_ENV=PRODUCTION`.

### Frontend → Vercel

1. Import the repo on Vercel and set **Root Directory** to `frontend`.
2. Add all `NEXT_PUBLIC_` environment variables.
   - Set `NEXT_PUBLIC_BACKEND_URL` and `NEXT_PUBLIC_SOCKET_SERVER_URL` to your Render backend's public URL.
3. Set **Build Command** to:
   ```bash
   npx prisma generate && npm run build
   ```
4. Deploy. Once live, go back to your Render service and confirm `VERCEL_FRONTEND_URL` matches your Vercel URL, then redeploy if needed.

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/your-feature-name`
3. **Commit** your changes: `git commit -m 'feat: add your feature'`
4. **Push** to the branch: `git push origin feature/your-feature-name`
5. **Open** a Pull Request

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages and ensure your code is properly typed (TypeScript).

---

## 📄 License

This project is licensed under the **Apache 2.0 License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

Made with ❤️ by [EllyCarlos](https://github.com/EllyCarlos)

</div>
