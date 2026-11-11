import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { createCustomerAuth, legalHashes } from "./auth";
import { readCustomerConfig, type CustomerConfig } from "./config";
import {
  connectCustomerDatabase,
  assertCustomerSchema,
  type CustomerDB,
} from "./database";
import { customerMailer } from "./mail";
import { legalDocuments, LEGAL_VERSION } from "./legal";
import { sanitizeCustomerData, mergeGuestData } from "./data";
import type { Order } from "../types";
export interface OrderIdentityBridge {
  list: () => Order[];
  authorizeGuest: (id: string, token?: string) => boolean;
  present: (order: Order) => any;
}
export async function mountCustomerAccounts(
  app: Express,
  orders: OrderIdentityBridge,
  override?: { config: CustomerConfig; db: CustomerDB; sendMail: any },
) {
  const config = override?.config || readCustomerConfig();
  const db =
    override?.db ||
    (config ? connectCustomerDatabase(config.databaseURL!) : null);
  let instance: ReturnType<typeof createCustomerAuth> | null = null;
  if (config && db) {
    await assertCustomerSchema(db); // Never silently create or migrate operational storage at boot.
    const mail = customerMailer(
      config,
      override ? db : connectCustomerDatabase(config.databaseURL!),
    );
    instance = createCustomerAuth(
      config,
      db,
      override?.sendMail || mail.enqueue,
    );
    if (!override) {
      const worker = setInterval(() => {
        mail
          .drain()
          .catch(() => console.error("[Customer] mail worker unavailable"));
      }, 10000);
      worker.unref();
    }
  }
  app.use(
    ["/cuenta", "/eliminar-cuenta", "/api/customer", "/api/customer-auth"],
    (_req, res, next) => {
      res.set({
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      next();
    },
  );
  app.get("/api/customer/config", (_req, res) =>
    res.json({
      simulation: !!override,
      configured: !!instance,
      registrationEnabled:
        !!instance && !!config?.smtp && !!config?.legalApproved,
      email: !!instance && !!config?.smtp,
      google: !!instance && !!config?.smtp && !!config?.google,
      apple: !!instance && !!config?.smtp && !!config?.apple,
      legalVersion: LEGAL_VERSION,
      legalHashes,
      legalStatus: !override && config?.legalApproved ? "approved" : "draft",
      notice: instance
        ? ""
        : "Estamos preparando el registro. Puedes explorar y comprar como invitado.",
    }),
  );
  app.get("/api/customer/legal/:kind", (req, res) => {
    const doc = legalDocuments[req.params.kind as keyof typeof legalDocuments];
    return doc
      ? res.json({
          version: LEGAL_VERSION,
          hash: legalHashes[req.params.kind],
          status: config?.legalApproved ? "approved" : "draft",
          ...doc,
        })
      : res.status(404).json({ error: "Documento no encontrado" });
  });
  if (instance) app.all("/api/customer-auth/*", toNodeHandler(instance.auth));
  else
    app.all("/api/customer-auth/*", (_req, res) =>
      res
        .status(503)
        .json({
          code: "CUSTOMER_AUTH_NOT_CONFIGURED",
          error: "Este método de acceso todavía no está configurado.",
        }),
    );
  const getSession = async (req: Request, res?: Response) => {
    if (!instance) return null;
    const result = await instance.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableRefresh: !res },
      returnHeaders: true,
    });
    // A server API call does not automatically forward renewed cookies to Express.
    if (res)
      for (const cookie of result.headers.getSetCookie())
        res.append("Set-Cookie", cookie);
    return result.response;
  };
  const guarded =
    (fn: (req: Request, res: Response, session: any) => Promise<any>) =>
    async (req: Request, res: Response) => {
      try {
        if (!instance || !db || !config)
          return res
            .status(503)
            .json({
              code: "CUSTOMER_AUTH_NOT_CONFIGURED",
              error: "Las cuentas aún no están habilitadas.",
            });
        if (
          !["GET", "HEAD"].includes(req.method) &&
          req.get("Origin") !== config.origin
        )
          return res
            .status(403)
            .json({ code: "ORIGIN_DENIED", error: "Origen no autorizado" });
        const session = await getSession(req);
        if (!session || !session.user.emailVerified)
          return res
            .status(401)
            .json({
              code: "CUSTOMER_SESSION_REQUIRED",
              error: "Inicia sesión con tu cuenta de cliente verificada.",
            });
        if (
          !["GET", "HEAD"].includes(req.method) &&
          req.get("X-Customer-Id") !== session.user.id
        )
          return res
            .status(409)
            .json({
              code: "CUSTOMER_CHANGED",
              error: "La sesión cambió. Revisa la cuenta antes de guardar.",
            });
        const pending = await db
          .selectFrom("customer_deletions")
          .select("status")
          .where("user_id", "=", session.user.id)
          .executeTakeFirst();
        if (pending)
          return res
            .status(403)
            .json({
              code: "ACCOUNT_DELETION_PENDING",
              error: "La eliminación verificada está en proceso.",
            });
        return await fn(req, res, session);
      } catch (e: any) {
        if (e.statusCode && e.statusCode < 500)
          return res
            .status(e.statusCode)
            .json({ error: "No se pudo autorizar la operación" });
        console.error("[Customer] request failed", e?.name);
        return res
          .status(500)
          .json({
            error:
              "No se pudo completar la operación de cuenta. Intenta nuevamente.",
          });
      }
    };
  app.get("/api/customer/me", async (req, res) => {
    try {
      const session = await getSession(req, res);
      if (!session) return res.json({ user: null });
      const row = await db!
        .selectFrom("customer_user")
        .select(["phone", "legalReceipt"])
        .where("id", "=", session.user.id)
        .executeTakeFirst();
      const receipt = JSON.parse(row?.legalReceipt || "{}");
      const prefs = await db!
        .selectFrom("customer_audit")
        .select("evidence")
        .where(
          "subject_hash",
          "=",
          (await import("node:crypto"))
            .createHmac("sha256", config!.secret)
            .update(`audit:${session.user.id}`)
            .digest("hex"),
        )
        .where("event", "=", "MARKETING_CHANGED")
        .orderBy("created_at", "desc")
        .limit(1)
        .executeTakeFirst();
      const accounts = await db!
        .selectFrom("customer_account")
        .select("providerId")
        .where("userId", "=", session.user.id)
        .execute();
      res.json({
        user: {
          providers: accounts.map((x) => x.providerId),
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          phone: row?.phone || "",
          createdAt: session.user.createdAt,
          marketing: prefs?.evidence?.enabled ?? receipt.marketing ?? false,
          legalVersion: receipt.version,
        },
        expiresAt: session.session.expiresAt,
      });
    } catch {
      res
        .status(503)
        .json({
          error: "No se pudo comprobar la sesión; vuelve a intentarlo.",
        });
    }
  });
  app.use("/api/customer", express.json({ limit: "350kb" }));
  app.patch(
    "/api/customer/profile",
    guarded(async (req, res, session) => {
      const name =
        typeof req.body.name === "string" ? req.body.name.trim() : "";
      const phone =
        typeof req.body.phone === "string" ? req.body.phone.trim() : "";
      if (
        !name ||
        name.length > 100 ||
        phone.length > 30 ||
        (phone && !/^[+\d\s()-]+$/.test(phone))
      )
        return res
          .status(400)
          .json({ error: "Revisa el nombre y el teléfono." });
      await db!
        .updateTable("customer_user")
        .set({ name, phone, updatedAt: new Date() })
        .where("id", "=", session.user.id)
        .execute();
      res.json({ ok: true });
    }),
  );
  app.put(
    "/api/customer/communications",
    guarded(async (req, res, session) => {
      if (typeof req.body.enabled !== "boolean")
        return res.status(400).json({ error: "Preferencia inválida" });
      await instance!.audit(session.user.id, "MARKETING_CHANGED", {
        enabled: req.body.enabled,
        version: LEGAL_VERSION,
      });
      res.json({ ok: true });
    }),
  );
  const data = async (id: string) => {
    await db!
      .insertInto("customer_data")
      .values({ user_id: id, payload: "{}" })
      .onConflict((oc) => oc.column("user_id").doNothing())
      .execute();
    return db!
      .selectFrom("customer_data")
      .select(["payload", "revision"])
      .where("user_id", "=", id)
      .executeTakeFirstOrThrow();
  };
  app.get(
    "/api/customer/data",
    guarded(async (_req, res, session) =>
      res.json(await data(session.user.id)),
    ),
  );
  app.put(
    "/api/customer/data",
    guarded(async (req, res, session) => {
      let payload;
      try {
        payload = sanitizeCustomerData(req.body.payload);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      if (!Number.isInteger(req.body.revision))
        return res.status(400).json({ error: "Versión requerida" });
      const updated = await db!
        .updateTable("customer_data")
        .set({
          payload: JSON.stringify(payload),
          revision: req.body.revision + 1,
          updated_at: new Date(),
        })
        .where("user_id", "=", session.user.id)
        .where("revision", "=", req.body.revision)
        .returning(["payload", "revision"])
        .executeTakeFirst();
      return updated
        ? res.json(updated)
        : res
            .status(409)
            .json({
              code: "ACCOUNT_DATA_CHANGED",
              error:
                "Tus datos cambiaron en otro dispositivo. Recarga para revisarlos; no sobrescribimos la otra versión.",
            });
    }),
  );
  app.post(
    "/api/customer/import",
    guarded(async (req, res, session) => {
      if (
        typeof req.body.importId !== "string" ||
        !/^[a-zA-Z0-9_-]{10,100}$/.test(req.body.importId)
      )
        return res
          .status(400)
          .json({ error: "Identificador de importación inválido" });
      let guest;
      try {
        guest = sanitizeCustomerData(req.body.payload);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      await data(session.user.id);
      const result = await db!.transaction().execute(async (tx) => {
        const current = await tx
          .selectFrom("customer_data")
          .selectAll()
          .where("user_id", "=", session.user.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const imported = await tx
          .selectFrom("customer_imports")
          .select("import_id")
          .where("user_id", "=", session.user.id)
          .where("import_id", "=", req.body.importId)
          .executeTakeFirst();
        if (imported)
          return { payload: current.payload, revision: current.revision };
        const payload = mergeGuestData(current.payload, guest),
          revision = current.revision + 1;
        await tx
          .updateTable("customer_data")
          .set({
            payload: JSON.stringify(payload),
            revision,
            updated_at: new Date(),
          })
          .where("user_id", "=", session.user.id)
          .execute();
        await tx
          .insertInto("customer_imports")
          .values({ user_id: session.user.id, import_id: req.body.importId })
          .execute();
        return { payload, revision };
      });
      res.json(result);
    }),
  );
  const canReadOrder = async (id: string, userId: string) => {
    const order = orders.list().find((o) => o.id === id);
    if (!order) return false;
    if ((order as any).customerAccountId === userId) return true;
    return !!(await db!
      .selectFrom("customer_order_links")
      .select("order_id")
      .where("order_id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst());
  };
  app.get(
    "/api/customer/orders",
    guarded(async (_req, res, session) => {
      const links = await db!
        .selectFrom("customer_order_links")
        .select("order_id")
        .where("user_id", "=", session.user.id)
        .execute();
      const ids = new Set(links.map((x) => x.order_id));
      res.json(
        orders
          .list()
          .filter(
            (o) =>
              (o as any).customerAccountId === session.user.id || ids.has(o.id),
          )
          .map(orders.present),
      );
    }),
  );
  app.post(
    "/api/customer/orders/:id/link",
    guarded(async (req, res, session) => {
      const order = orders.list().find((o) => o.id === req.params.id);
      if (
        !order ||
        !orders.authorizeGuest(req.params.id, req.get("X-Order-Token")) ||
        ((order as any).customerAccountId &&
          (order as any).customerAccountId !== session.user.id)
      )
        return res
          .status(403)
          .json({
            error:
              "Se requiere verificar la titularidad mediante el acceso privado de la compra.",
          });
      await db!
        .insertInto("customer_order_links")
        .values({
          order_id: order.id,
          user_id: session.user.id,
          evidence: "guest-capability",
        })
        .onConflict((oc) => oc.column("order_id").doNothing())
        .execute();
      if (!(await canReadOrder(order.id, session.user.id)))
        return res
          .status(409)
          .json({ error: "La compra ya está vinculada a otra cuenta." });
      await instance!.audit(session.user.id, "ORDER_LINKED", {
        orderId: order.id,
        proof: "guest-capability",
      });
      res.json({ ok: true });
    }),
  );
  return {
    attachOrderOwner: async (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const session = await getSession(req);
        if (session?.user.emailVerified) {
          if (req.get("Origin") !== config?.origin)
            return res.status(403).json({ error: "Origen no autorizado" });
          (req as any).customerAccountId = session.user.id;
        }
        next();
      } catch {
        res
          .status(503)
          .json({
            error:
              "No se pudo verificar la cuenta antes de confirmar. Intenta nuevamente.",
          });
      }
    },
    authorizeOrder: async (req: Request, id: string) => {
      const session = await getSession(req);
      return (
        !!session?.user.emailVerified &&
        (["GET", "HEAD"].includes(req.method) ||
          req.get("Origin") === config?.origin) &&
        (await canReadOrder(id, session.user.id))
      );
    },
    instance,
    db,
  };
}
