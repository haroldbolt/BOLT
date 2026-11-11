export interface CustomerConfig {
  origin: string;
  secret: string;
  databaseURL?: string;
  legalApproved: boolean;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  google?: { clientId: string; clientSecret: string };
  apple?: { clientId: string; clientSecret: string };
}
export function readCustomerConfig(
  env: NodeJS.ProcessEnv = process.env,
): CustomerConfig | null {
  if (
    !env.BOLT_CUSTOMER_DATABASE_URL ||
    !env.BOLT_CUSTOMER_ORIGIN ||
    !env.BOLT_CUSTOMER_SECRET
  )
    return null;
  const url = new URL(env.BOLT_CUSTOMER_ORIGIN);
  if (
    url.origin !== env.BOLT_CUSTOMER_ORIGIN ||
    (url.protocol !== "https:" &&
      !(env.NODE_ENV !== "production" && url.hostname === "127.0.0.1"))
  )
    throw Error("Customer origin must be an exact HTTPS origin");
  if (env.BOLT_CUSTOMER_SECRET.length < 32)
    throw Error("Customer secret must contain at least 32 random characters");
  const smtp =
    env.BOLT_SMTP_HOST &&
    env.BOLT_SMTP_USER &&
    env.BOLT_SMTP_PASSWORD &&
    env.BOLT_SMTP_FROM
      ? {
          host: env.BOLT_SMTP_HOST,
          port: Number(env.BOLT_SMTP_PORT || 465),
          secure: env.BOLT_SMTP_SECURE !== "false",
          user: env.BOLT_SMTP_USER,
          pass: env.BOLT_SMTP_PASSWORD,
          from: env.BOLT_SMTP_FROM,
        }
      : undefined;
  return {
    origin: url.origin,
    secret: env.BOLT_CUSTOMER_SECRET,
    databaseURL: env.BOLT_CUSTOMER_DATABASE_URL,
    legalApproved: env.BOLT_LEGAL_APPROVED_VERSION === "2026-11-10-draft-1",
    smtp,
    google:
      env.BOLT_GOOGLE_CLIENT_ID && env.BOLT_GOOGLE_CLIENT_SECRET
        ? {
            clientId: env.BOLT_GOOGLE_CLIENT_ID,
            clientSecret: env.BOLT_GOOGLE_CLIENT_SECRET,
          }
        : undefined,
    apple:
      env.BOLT_APPLE_SERVICE_ID && env.BOLT_APPLE_CLIENT_SECRET
        ? {
            clientId: env.BOLT_APPLE_SERVICE_ID,
            clientSecret: env.BOLT_APPLE_CLIENT_SECRET,
          }
        : undefined,
  };
}
export type CustomerSession = {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: Date;
  };
  session: { id: string; createdAt: Date; expiresAt: Date };
};
