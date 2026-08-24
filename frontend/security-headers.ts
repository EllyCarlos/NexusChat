type Header = {
  key: string;
  value: string;
};

type HeaderRule = {
  source: string;
  headers: Header[];
};

type PublicEnvironment = Readonly<Record<string, string | undefined>>;

const toOrigin = (value: string | undefined) => {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

const configuredConnectionSources = (environment: PublicEnvironment) => {
  const sources = new Set<string>();

  for (const key of [
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_BASE_URL",
    "NEXT_PUBLIC_ABSOLUTE_BASE_URL",
  ]) {
    const origin = toOrigin(environment[key]);
    if (!origin) continue;

    sources.add(origin);
    const url = new URL(origin);
    sources.add(`${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`);
  }

  return [...sources];
};

export const createContentSecurityPolicy = (
  nodeEnvironment: string | undefined,
  environment: PublicEnvironment,
) => {
  const scriptSources = ["'self'", "'unsafe-inline'", "https://www.gstatic.com"];
  if (nodeEnvironment !== "production") scriptSources.push("'unsafe-eval'");

  const directives = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["frame-src", "'none'"],
    ["form-action", "'self'"],
    ["script-src", ...scriptSources],
    ["style-src", "'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    ["font-src", "'self'", "data:", "https://fonts.gstatic.com"],
    [
      "img-src",
      "'self'",
      "data:",
      "blob:",
      "https://images.pexels.com",
      "https://res.cloudinary.com",
      "https://lh3.googleusercontent.com",
      "https://media.tenor.com",
      "https://nexuswebapp.vercel.app",
    ],
    ["media-src", "'self'", "blob:", "https://res.cloudinary.com"],
    [
      "connect-src",
      "'self'",
      ...configuredConnectionSources(environment),
      "https://tenor.googleapis.com",
      "https://firebaseinstallations.googleapis.com",
      "https://fcmregistrations.googleapis.com",
    ],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
  ];

  return directives.map((directive) => directive.join(" ")).join("; ");
};

export const createSecurityHeaderRules = (
  nodeEnvironment: string | undefined,
  environment: PublicEnvironment = process.env,
): HeaderRule[] => {
  const securityHeaders: Header[] = [
    {
      key: "Content-Security-Policy",
      value: createContentSecurityPolicy(nodeEnvironment, environment),
    },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Frame-Options", value: "DENY" },
  ];

  if (nodeEnvironment === "production") {
    securityHeaders.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000",
    });
  }

  const noStore = [{ key: "Cache-Control", value: "no-store" }];

  return [
    { source: "/:path*", headers: securityHeaders },
    { source: "/auth/:path*", headers: noStore },
    { source: "/api/auth/:path*", headers: noStore },
    {
      source: "/auth/oauth-redirect",
      headers: [
        ...noStore,
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    },
  ];
};
