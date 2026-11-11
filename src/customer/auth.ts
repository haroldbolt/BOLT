import { queueAfterTransactionHook } from "@better-auth/core/context";
import crypto from "node:crypto";
import { betterAuth } from "better-auth";
import {
  createAuthMiddleware,
  APIError,
  getOAuthState,
  addOAuthServerContext,
} from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { customerEmailConfigured, type CustomerConfig } from "./config";
import type { CustomerDB } from "./database";
import { LEGAL_VERSION, legalDocuments } from "./legal";
export const legalHashes = Object.fromEntries(
  Object.entries(legalDocuments).map(([key, value]) => [
    key,
    crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  ]),
);
export function acceptLegal(input: any) {
  if (
    input?.version !== LEGAL_VERSION ||
    input?.terms !== true ||
    input?.privacy !== true
  )
    throw new APIError("BAD_REQUEST", {
      code: "LEGAL_CONSENT_REQUIRED",
      message:
        "Acepta los términos y autoriza el tratamiento de datos de la versión vigente.",
    });
  return {
    version: LEGAL_VERSION,
    documents: {
      terminos: legalHashes.terminos,
      privacidad: legalHashes.privacidad,
    },
    acceptedAt: new Date().toISOString(),
    terms: true,
    privacy: true,
    marketing: input.marketing === true,
  };
}
export type CustomerMail = { to: string; subject: string; url: string };
export function createCustomerAuth(
  config: CustomerConfig,
  db: CustomerDB,
  sendMail: (mail: CustomerMail) => Promise<void>,
  revokeApple?: (token: string) => Promise<void>,
) {
  const deliver = (mail: CustomerMail) =>
    queueAfterTransactionHook(() => sendMail(mail));
  const hashSubject = (id: string) =>
    crypto
      .createHmac("sha256", config.secret)
      .update(`audit:${id}`)
      .digest("hex");
  const revoke =
    revokeApple ||
    (async (token: string) => {
      if (!config.apple) throw Error("Apple revocation configuration missing");
      const response = await fetch("https://appleid.apple.com/auth/revoke", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.apple.clientId,
          client_secret: config.apple.clientSecret,
          token,
          token_type_hint: "refresh_token",
        }),
      });
      if (!response.ok) throw Error("Apple revocation pending");
    });
  const audit = async (id: string, event: string, evidence: any) => {
    await db
      .insertInto("customer_audit")
      .values({
        id: crypto.randomUUID(),
        subject_hash: hashSubject(id),
        event,
        evidence: JSON.stringify(evidence),
      })
      .execute();
  };
  const beforeDelete = async (user: { id: string }) => {
    const record = await db
      .selectFrom("customer_user")
      .select(["email", "legalReceipt"])
      .where("id", "=", user.id)
      .executeTakeFirst();
    if (record) {
      await audit(user.id, "DELETION_VERIFIED", {
        legalReceipt: JSON.parse(record.legalReceipt),
      });
      await db
        .deleteFrom("customer_mail")
        .where(
          "recipient_hash",
          "=",
          crypto
            .createHmac("sha256", config.secret)
            .update(record.email.toLowerCase())
            .digest("hex"),
        )
        .execute();
    }
    await db
      .insertInto("customer_deletions")
      .values({ user_id: user.id, status: "PENDING_PROVIDER" })
      .onConflict((oc) => oc.column("user_id").doNothing())
      .execute();
    await db
      .updateTable("customer_user")
      .set({ deletionPending: true })
      .where("id", "=", user.id)
      .execute();
    // Verification has already succeeded. Immediately revoke every customer session.
    await db
      .deleteFrom("customer_session")
      .where("userId", "=", user.id)
      .execute();
    const accounts = await db
      .selectFrom("customer_account")
      .selectAll()
      .where("userId", "=", user.id)
      .where("providerId", "=", "apple")
      .execute();
    for (const account of accounts) {
      if (!account.refreshToken)
        throw new APIError("SERVICE_UNAVAILABLE", {
          code: "APPLE_REVOCATION_PENDING",
          message:
            "Solicitud verificada. Falta completar la revocación con Apple; el acceso a tu cuenta ya está bloqueado.",
        });
      try {
        await revoke(
          await symmetricDecrypt({
            key: config.secret,
            data: account.refreshToken,
          }),
        );
      } catch {
        await audit(user.id, "DELETE_PENDING_PROVIDER", {});
        throw new APIError("SERVICE_UNAVAILABLE", {
          code: "APPLE_REVOCATION_PENDING",
          message:
            "La eliminación está pendiente de revocación con Apple. Tus sesiones ya están cerradas.",
        });
      }
    }
  };
  const afterDelete = async (user: { id: string }) => {
    await db
      .updateTable("customer_deletions")
      .set({ status: "COMPLETED", completed_at: new Date() })
      .where("user_id", "=", user.id)
      .execute();
    await audit(user.id, "ACCOUNT_DELETED", {
      commercialRecords: "retained separately; no order state changed",
    });
  };
  const auth = betterAuth({
    appName: "Bolt by Agrocentro",
    baseURL: config.origin,
    basePath: "/api/customer-auth",
    secret: config.secret,
    database: { db, type: "postgres", transaction: true },
    trustedOrigins: [
      config.origin,
      ...(config.apple ? ["https://appleid.apple.com"] : []),
    ],
    advanced: {
      cookiePrefix: "bolt_customer",
      useSecureCookies: config.origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      // Apple returns via cross-site POST. Only the short-lived state proof needs
      // SameSite=None; session cookies remain Lax and state validation stays on.
      ...(config.apple && config.origin.startsWith("https:") ? { cookies: {
        state: { attributes: { sameSite: "none" as const, secure: true } },
        oauth_state: { attributes: { sameSite: "none" as const, secure: true } },
      } } : {}),
      disableCSRFCheck: false,
    },
    session: {
      modelName: "customer_session",
      expiresIn: 7 * 86400,
      updateAge: 86400,
      freshAge: 900,
      cookieCache: { enabled: false },
    },
    verification: { modelName: "customer_verification" },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "customer_rate_limit",
      window: 60,
      max: 60,
      customRules: {
        "/sign-up/email": { window: 60, max: 5 },
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
      },
    },
    account: {
      modelName: "customer_account",
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
    },
    socialProviders: {
      ...(customerEmailConfigured(config) && config.google
        ? { google: { ...config.google, disableImplicitSignUp: true } }
        : {}),
      ...(customerEmailConfigured(config) && config.apple
        ? {
            apple: {
              ...config.apple,
              disableImplicitSignUp: true,
              overrideUserInfoOnSignIn: false,
            },
          }
        : {}),
    },
    emailAndPassword: {
      enabled: customerEmailConfigured(config),
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        deliver({
          to: user.email,
          subject: "Restablece tu contraseña de BOLT",
          url,
        }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) =>
        deliver({ to: user.email, subject: "Verifica tu correo en BOLT", url }),
    },
    user: {
      modelName: "customer_user",
      additionalFields: {
        legalReceipt: {
          type: "string",
          required: true,
          input: false,
          returned: false,
          defaultValue: "",
        },
        phone: { type: "string", required: false, input: false },
        deletionPending: {
          type: "boolean",
          required: false,
          input: false,
          returned: false,
          defaultValue: false,
        },
      },
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, url }) =>
          deliver({
            to: user.email,
            subject: "Confirma el cambio de correo de BOLT",
            url,
          }),
      },
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user, url }) =>
          deliver({
            to: user.email,
            subject: "Confirma la eliminación permanente de tu cuenta BOLT",
            url,
          }),
        beforeDelete,
        afterDelete,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/sign-up/email" ||
          (ctx.path === "/sign-in/social" && ctx.body?.requestSignUp)
        ) {
          if (!config.legalApproved)
            throw new APIError("FORBIDDEN", {
              code: "LEGAL_REVIEW_PENDING",
              message:
                "El registro estará disponible tras aprobar los documentos legales.",
            });
          const receipt = acceptLegal(
            ctx.body?.legalConsent || ctx.body?.additionalData?.legalConsent,
          );
          if (ctx.path === "/sign-in/social")
            await addOAuthServerContext({ boltLegalReceipt: receipt });
        }
        // Linking is a separate, explicit, authenticated operation, with a recent session.
        if (ctx.path === "/link-social") {
          const session = await auth.api.getSession({ headers: ctx.headers! });
          if (
            !session ||
            !session.user.emailVerified ||
            Date.now() - new Date(session.session.createdAt).getTime() > 900000
          )
            throw new APIError("UNAUTHORIZED", {
              message:
                "Vuelve a iniciar sesión antes de vincular un método de acceso.",
            });
        }
        if (ctx.path === "/sign-in/social" && ctx.body?.idToken)
          throw new APIError("BAD_REQUEST", {
            message:
              "Utiliza el flujo web de autorización; acceso nativo pendiente de habilitar.",
          });
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (!config.legalApproved)
              throw new APIError("FORBIDDEN", {
                message: "Revisión legal pendiente",
              });
            const receipt =
              ctx?.path === "/sign-up/email"
                ? acceptLegal(ctx.body?.legalConsent)
                : (await getOAuthState())?.serverContext?.boltLegalReceipt;
            if (!receipt || (receipt as any).version !== LEGAL_VERSION)
              throw new APIError("BAD_REQUEST", {
                code: "LEGAL_CONSENT_REQUIRED",
                message:
                  "Completa el registro y acepta los documentos vigentes.",
              });
            return {
              data: {
                ...user,
                name: user.name.trim().slice(0, 100),
                legalReceipt: JSON.stringify(receipt),
              },
            };
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const user = await ctx?.context.internalAdapter.findUserById(
              session.userId,
            );
            if ((user as any)?.deletionPending)
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_DELETION_PENDING",
                message:
                  "Tu cuenta tiene una solicitud de eliminación verificada.",
              });
            return { data: session };
          },
        },
      },
    },
    onAPIError: { errorURL: `${config.origin}/cuenta?error=oauth` },
    logger: { disabled: true },
  });
  return { auth, beforeDelete, afterDelete, audit };
}
export type CustomerAuth = ReturnType<typeof createCustomerAuth>;
