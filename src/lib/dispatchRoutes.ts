import type { Express, Request, Response, NextFunction } from "express";
import { DispatchService, DispatchError } from "./dispatchService";
import type { OrdersRepository } from "./ordersRepository";
export function mountDispatchRoutes(
  app: Express,
  s: DispatchService,
  repo: OrdersRepository,
  admin: (req: Request, res: Response, next: NextFunction) => unknown,
) {
  const handler =
    (fn: (req: Request) => any) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve()
        .then(() => fn(req))
        .then((value) => res.json(value ?? { ok: true }))
        .catch((e) => {
          if (e instanceof DispatchError)
            res.status(e.status).json({ code: e.code, error: e.message });
          else {
            console.error("[Dispatch] operation failed", e?.name);
            res
              .status(500)
              .json({
                code: "OPERATION_FAILED",
                error:
                  "No se pudo completar la operación. Reintenta con el mismo identificador.",
              });
          }
        });
    };
  const token = (req: Request) =>
    req.get("Authorization")?.replace(/^Bearer /, "");
  const driver = (req: Request, res: Response, next: NextFunction) => {
    const id = s.authenticate(token(req));
    if (!id)
      return res
        .status(401)
        .json({
          error: "Inicia sesión en BOLT Conductor",
          code: "UNAUTHORIZED",
        });
    (req as any).driverId = id;
    next();
  };
  const did = (req: Request) => (req as any).driverId as string;
  const aid = (req: Request) => (req as any).adminSession.userId as string;
  app.use(["/api/v1/driver", "/api/v1/admin/dispatch"], (_q, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.post(
    "/api/v1/driver/auth/login",
    handler((req) => {
      const result = s.login(req.body.email, req.body.password);
      if (result.error)
        throw new DispatchError(result.status!, "LOGIN_FAILED", result.error);
      return result;
    }),
  );
  app.use("/api/v1/driver", driver);
  app.post(
    "/api/v1/driver/auth/logout",
    handler((req) => s.logout(token(req)!)),
  );
  app.get(
    "/api/v1/driver/profile",
    handler((req) => s.profile(did(req))),
  );
  app.post(
    "/api/v1/driver/shift",
    handler((req) => s.shift(did(req), req.body.action)),
  );
  app.post(
    "/api/v1/driver/heartbeat",
    handler((req) => s.heartbeat(did(req))),
  );
  app.post(
    "/api/v1/driver/location",
    handler((req) => s.location(did(req), req.body)),
  );
  app.get(
    "/api/v1/driver/assignments",
    handler((req) => ({ assignments: s.driverAssignments(did(req)) })),
  );
  app.get(
    "/api/v1/driver/assignments/:assignmentId",
    handler((req) =>
      s.driverDispatch(
        repo.dispatchState.runs[req.params.assignmentId] ||
          (() => {
            throw new DispatchError(404, "NOT_FOUND", "Despacho no encontrado");
          })(),
        did(req),
      ),
    ),
  );
  for (const action of ["accept", "reject"] as const)
    app.post(
      `/api/v1/driver/assignments/:assignmentId/${action}`,
      handler(async (req) => {
        const offer = repo.dispatchState.offers[req.body.offerId];
        if (!offer || offer.dispatchId !== req.params.assignmentId)
          throw new DispatchError(
            409,
            "OFFER_REQUIRED",
            "Selecciona la oferta vigente",
          );
        const result = s.respond(did(req), offer.id, action);
        if (!result.ok) await s.search(result.dispatchId);
        return result;
      }),
    );
  app.post(
    "/api/v1/driver/assignments/:assignmentId/arrived-hub",
    handler((req) => s.arrived(did(req), req.params.assignmentId)),
  );
  app.post(
    "/api/v1/driver/assignments/:assignmentId/pickup",
    handler((req) =>
      s.pickup(did(req), req.params.assignmentId, req.body.sellablePackages),
    ),
  );
  app.post(
    "/api/v1/driver/assignments/:assignmentId/delivered",
    handler((req) =>
      s.deliver(
        did(req),
        req.params.assignmentId,
        req.body.deliveryCode,
        req.body.collectedCOP,
      ),
    ),
  );
  app.post(
    "/api/v1/driver/assignments/:assignmentId/incident",
    handler((req) =>
      s.incident(did(req), req.params.assignmentId, req.body.type),
    ),
  );
  app.post(
    "/api/v1/driver/assignments/:assignmentId/release",
    handler((req) => s.confirmRelease(did(req), req.params.assignmentId)),
  );
  app.post(
    "/api/v1/driver/assignments/:assignmentId/release-custody",
    handler((req) => s.releaseCustody(did(req), req.params.assignmentId)),
  );
  app.post(
    "/api/v1/driver/assignments/:assignmentId/accept-custody",
    handler((req) => s.acceptCustody(did(req), req.params.assignmentId)),
  );
  app.get(
    "/api/v1/driver/settlement",
    handler((req) => s.settlement(did(req))),
  );
  app.post(
    "/api/v1/driver/gps",
    handler((req) => {
      const id = did(req),
        r = repo.dispatchState.runs[req.body.assignmentId];
      if (
        !r ||
        r.driverId !== id ||
        r.orderId !== req.body.orderId ||
        r.shipmentId !== req.body.shipmentId ||
        r.status !== "PICKED_UP"
      )
        throw new DispatchError(403, "FORBIDDEN", "Telemetría no autorizada");
      return repo.transaction(() => {
        s.location(id, req.body);
        const result = repo.recordTelemetry(
          { ...req.body, driverId: id },
          { role: "CONDUCTOR", id },
        );
        if (!result.success)
          throw new DispatchError(
            result.code || 400,
            "INVALID_TELEMETRY",
            result.error!,
          );
        return { status: "telemetry_received", point: result.point };
      });
    }),
  );
  app.use("/api/v1/admin/dispatch", admin);
  app.get(
    "/api/v1/admin/dispatch",
    handler(() => s.adminView()),
  );
  app.put(
    "/api/v1/admin/dispatch/config",
    handler((req) => s.updateConfig(req.body, aid(req))),
  );
  app.post(
    "/api/v1/admin/dispatch/drivers",
    handler((req) => s.provision(req.body, aid(req))),
  );
  app.patch(
    "/api/v1/admin/dispatch/drivers/:id",
    handler((req) => s.updateAccount(req.params.id, req.body, aid(req))),
  );
  app.post(
    "/api/v1/admin/dispatch/drivers/:id/settlement",
    handler((req) =>
      s.settle(req.params.id, req.body.amountCOP, req.body.receiptId, aid(req)),
    ),
  );
  app.post(
    "/api/v1/admin/dispatch/orders/:orderId/register",
    handler((req) => s.registerHistoricalOrder(req.params.orderId,aid(req))),
  );
  app.post(
    "/api/v1/admin/dispatch/:id/reconcile-legacy",
    handler((req) => s.reconcileLegacy(req.params.id, req.body, aid(req))),
  );
  app.post(
    "/api/v1/admin/dispatch/:id/search",
    handler(async (req) => {
      await s.search(req.params.id, aid(req));
      return s.adminView();
    }),
  );
  app.post(
    "/api/v1/admin/dispatch/:id/restart-search",
    handler((req) => s.restart(req.params.id, aid(req))),
  );
  app.post(
    "/api/v1/admin/dispatch/:id/release",
    handler((req) => s.requestRelease(req.params.id, aid(req))),
  );
  app.post(
    "/api/v1/admin/dispatch/:id/reconcile",
    handler((req) => s.reconcile(req.params.id)),
  );
  app.post(
    "/api/v1/admin/dispatch/:id/cancel-external",
    handler((req) => s.cancelExternal(req.params.id, aid(req))),
  );
  app.post(
    "/api/v1/admin/dispatch/:id/transfer",
    handler((req) =>
      s.requestTransfer(req.params.id, req.body.toDriverId, aid(req)),
    ),
  );
  app.post(
    "/api/v1/admin/dispatch/:id/simulate",
    handler((req) =>
      s.externalProgress(
        req.params.id,
        req.body.action,
        aid(req),
        req.body.deliveryCode,
        req.body.collectedCOP,
      ),
    ),
  );
}

/** Order capability is independent of purchase/dispatch display codes and driver tokens. */
export function mountOrderAccess(
  app: Express,
  s: DispatchService,
  verifyAdmin: (token?: string) => any,
) {
  app.use("/api/v1/orders/:orderId", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const session = verifyAdmin(
      req.get("Authorization")?.replace(/^Bearer /, ""),
    );
    if (session) {
      (req as any).adminSession = session;
      return next();
    }
    if (s.authorizeGuest(req.params.orderId, req.get("X-Order-Token"))) {
      (req as any).authorizedOrderId = req.params.orderId;
      return next();
    }
    return res
      .status(403)
      .json({
        code: "ORDER_ACCESS_REQUIRED",
        error: "Se requiere el acceso privado de esta compra.",
      });
  });
}
