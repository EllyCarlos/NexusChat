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
| 🛡️ **Security** | bcrypt password hashing, JWT sessions, secure token handling with `jose` |
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
| **CORS** | Cross-origin configuration |
| **Multer** | File upload handling |
| **Morgan** | HTTP request logging |

---

## 📁 Project Structure

```
NexusChat/
├── frontend/                       # Next.js 15 application
│   ├── src/app/                    # App Router pages, layouts, and API routes
│   ├── src/components/             # Reusable UI components
│   ├── src/lib/                    # Client and server utilities
│   ├── prisma/                     # Prisma schema and checked-in migrations
│   ├── .env.example                # Sanitized frontend environment template
│   ├── package.json
│   └── package-lock.json
├── backend/                        # Node.js + Express + Socket.IO API
│   ├── src/routes/                 # Express routers
│   ├── src/controllers/            # Request handlers and business logic
│   ├── src/middlewares/            # Authentication, upload, and error middleware
│   ├── prisma/                     # Prisma schema and seed script (no migrations)
│   ├── .env.development.example    # Development environment template
│   ├── .env.production.example     # Production environment template
│   ├── package.json
│   └── package-lock.json
├── .gitignore
├── .nvmrc
├── LICENSE
└── readme.md
```

---

## ⚙️ Local Setup

### Prerequisites

- **Node.js** 24.x (the root `.nvmrc` contains `24`)
- **npm** 11.x
- **Git**
- **PostgreSQL** database
- [**Firebase Project**](https://console.firebase.google.com/) (for push notifications)
- [**Cloudinary Account**](https://cloudinary.com/) (for file/image storage)
- [**Google OAuth Credentials**](https://console.cloud.google.com/) (for social login)
- A Gmail account/app password for the current Nodemailer configuration

If you use a compatible Node version manager, select the repository toolchain with:

```bash
nvm use
```

The frontend and backend are separate npm packages; there is no root `package.json`.

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
npm ci
```

The backend loader uses environment-specific files and does not read a generic `.env` file. For local development, copy the sanitized development template and replace every placeholder:

```bash
cp .env.development.example .env.development
```

Development Firebase Admin initialization currently loads `backend/firebase-admin-cred.json` directly. Download a Firebase service-account JSON file to that exact path and never commit it. The Google OAuth development redirect URI is `http://localhost:<PORT>/api/v1/auth/google/callback`.

An external lowercase `NODE_ENV` selects the matching file. If it is absent, the backend safely defaults to `development` and loads `.env.development`. Supported values are `development`, `production`, and `test`; invalid values fail validation before any env file is loaded. The `test` value selects `.env.test`, but the repository does not currently provide that file, an example for it, or a test harness.

The backend listens on the required `PORT` value. The example uses `5000`, so its local URL is `http://localhost:5000`.

---

### 3. Frontend Setup

```bash
cd ../frontend
npm ci
```

Copy the sanitized frontend template to the development filename and replace every placeholder:

```bash
cp .env.example .env.development
```

The frontend template contains both browser-exposed `NEXT_PUBLIC_` configuration and server-only values used by Next.js server code. `JWT_SECRET` is validated when session signing or verification executes at runtime; importing route modules during a production build does not require it.

### 4. Database Setup

Both packages contain PostgreSQL Prisma schemas and generate their own Prisma clients. Configure their database URLs for the PostgreSQL database used by the application. Only `frontend/prisma/migrations` contains checked-in migration history; the backend has no migration directory.

Apply the checked-in development migration from the frontend package:

```bash
npm run migrate:dev
```

Despite its name, this script runs `prisma migrate deploy` with `.env.development`. Do not run `prisma migrate dev --name init` in the backend: there is no checked-in backend migration history to extend.

### 5. Start the Development Servers

From the repository root, start the backend in one terminal.

macOS, Linux, or Git Bash:

```bash
cd backend
npm run dev
```

PowerShell:

```powershell
cd backend
npm run dev
```

Start the frontend in a second terminal from the repository root:

```bash
cd frontend
npm run dev
```

Next.js serves the frontend on `http://localhost:3000` by default.

### Available Scripts

Run each command from the relevant package directory.

| Package | Command | Behavior |
|---|---|---|
| Frontend | `npm run dev` | Start the Next.js development server |
| Frontend | `npm run build` | Generate the Prisma client and create a production build |
| Frontend | `npm run start` | Start a previously built Next.js application |
| Frontend | `npm run migrate:dev` | Deploy checked-in migrations using `.env.development` |
| Frontend | `npm run migrate:prod` | Deploy checked-in migrations using `.env.production` |
| Backend | `npm run dev` | Start the TypeScript development server |
| Backend | `npm run ts.check` | Type-check without emitting JavaScript |
| Backend | `npm run build` | Clean `backend/dist` and compile TypeScript |
| Backend | `npm run build:production` | Build, then prune development and unused optional dependencies for the production runtime |
| Backend | `npm run start` | Run `backend/dist/index.js` after a build |

The repository currently has no root npm scripts and no automated test script.

---

## 🚀 Deployment

The current source configuration targets **Vercel** for the frontend and **Render** for the backend. Production hostnames are still partly hardcoded in the backend, so deploying under different domains requires aligning that existing configuration in a later environment-loading cleanup.

### Backend → Render

1. Provision a PostgreSQL database and apply the checked-in frontend migration from a controlled environment using `npm run migrate:prod` and an untracked `frontend/.env.production` created from `frontend/.env.example`.
2. Create a Web Service and set:
   - **Root Directory:** `backend`
   - **Build Command:** `npm ci && npm run build:production`
   - **Start Command:** `npm start`
3. Configure platform environment variables from `backend/.env.production.example`, including `NODE_ENV=production`, database credentials, and the production Firebase Admin values. Do not copy placeholder values unchanged.

The Render build uses a full `npm ci` first so the backend postinstall can generate Prisma Client and the TypeScript build has its development tooling. `npm run build:production` then compiles the backend and prunes development dependencies plus optional dependencies without re-running lifecycle scripts. The final runtime keeps generated `@prisma/client` and Firebase Admin App/Messaging, while omitting the unused Firebase Admin Storage and Firestore dependency graphs. Continue using plain `npm ci` for local development and validation; optional-dependency omission is intentionally limited to the final production runtime tree.

### Frontend → Vercel

1. Import the repo on Vercel and set **Root Directory** to `frontend`.
2. Configure all required values from `frontend/.env.example`, including its server-only database, email, recovery, and `JWT_SECRET` values—not only the `NEXT_PUBLIC_` variables.
3. Point the public API and Socket.IO URL values at the deployed backend and set the public client URL to the deployed frontend.
4. Use `npm ci` for installation and `npm run build` for the build. The build script already runs `prisma generate`.

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
