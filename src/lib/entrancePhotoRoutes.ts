import express, { type Express, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import type { OrdersRepository } from "./ordersRepository";
import type { DispatchService } from "./dispatchService";
import {
  ENTRANCE_PHOTO_MAX_BYTES,
  photoDestinationKey,
  validPhotoId,
} from "./entrancePhotoShared";
interface StoredPhoto {
  version: 1;
  orderId: string;
  sourceId: string;
  sha256: string;
  jpeg: string;
  width: number;
  height: number;
  createdAt: string;
  actor: string;
  destinationKey: string;
}
/** One immutable, private record is the sole photo source. Atomic link commits metadata + bytes together. */
export class EntrancePhotoRepository {
  constructor(readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  private file(orderId: string) {
    return path.join(
      this.directory,
      crypto.createHash("sha256").update(orderId).digest("hex") + ".json",
    );
  }
  read(orderId: string): StoredPhoto | undefined {
    const file = this.file(orderId);
    if (!fs.existsSync(file)) return;
    const value: StoredPhoto = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      value.version !== 1 ||
      value.orderId !== orderId ||
      crypto
        .createHash("sha256")
        .update(Buffer.from(value.jpeg, "base64"))
        .digest("hex") !== value.sha256
    )
      throw Error("Invalid photo record");
    return value;
  }
  commit(value: StoredPhoto): { created: boolean; record: StoredPhoto } {
    const target = this.file(value.orderId),
      tmp = target + "." + crypto.randomUUID() + ".tmp";
    try {
      const fd = fs.openSync(tmp, "wx", 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(value));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        fs.linkSync(tmp, target);
        const fd = fs.openSync(this.directory, "r");
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        return { created: true, record: value };
      } catch (e: any) {
        if (e.code !== "EEXIST") throw e;
        return { created: false, record: this.read(value.orderId)! };
      }
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }
}
export function mountEntrancePhotos(
  app: Express,
  orders: OrdersRepository,
  dispatch: DispatchService,
  directory: string,
) {
  const photos = new EntrancePhotoRepository(directory);
  const unavailable = (res: Response) =>
    res
      .status(403)
      .json({
        error: "No tienes acceso a esta foto.",
        code: "PHOTO_ACCESS_REQUIRED",
      });
  const serve = (res: Response, orderId: string) => {
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    try {
      const photo = photos.read(orderId);
      if (!photo) return res.status(404).json({ code: "PHOTO_NOT_ATTACHED" });
      return res.type("image/jpeg").send(Buffer.from(photo.jpeg, "base64"));
    } catch {
      return res
        .status(503)
        .json({ error: "La foto no está disponible temporalmente." });
    }
  };
  // Registered AFTER mountOrderAccess: only a verified administrator or this order's private capability.
  app.get("/api/v1/orders/:orderId/entrance-photo", (req, res) => {
    if (
      !(req as any).adminSession &&
      (req as any).authorizedOrderId !== req.params.orderId
    )
      return unavailable(res);
    if (!orders.getOrderById(req.params.orderId))
      return res.status(404).json({ error: "Pedido no encontrado" });
    return serve(res, req.params.orderId);
  });
  app.put(
    "/api/v1/orders/:orderId/entrance-photo",
    express.raw({ type: "image/jpeg", limit: ENTRANCE_PHOTO_MAX_BYTES }),
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");
      if (
        !(req as any).adminSession &&
        (req as any).authorizedOrderId !== req.params.orderId
      )
        return unavailable(res);
      const order = orders.getOrderById(req.params.orderId);
      if (!order)
        return res.status(404).json({ error: "Pedido no encontrado" });
      if (
        !validPhotoId(req.get("X-Photo-Id")) ||
        !Buffer.isBuffer(req.body) ||
        !req.body.length ||
        req.get("Content-Type") !== "image/jpeg"
      )
        return res.status(400).json({ error: "Foto inválida." });
      let destinationKey = "";
      try {
        destinationKey = decodeURIComponent(
          req.get("X-Photo-Destination") || "",
        );
      } catch {}
      if (destinationKey !== photoDestinationKey(order.deliveryAddress))
        return res
          .status(409)
          .json({
            error: "La foto corresponde a otro destino.",
            code: "PHOTO_DESTINATION_MISMATCH",
          });
      try {
        // Full decoding also rejects spoofed MIME, SVG, truncated images and oversized pixel counts.
        const decoder = sharp(req.body, {
            limitInputPixels: 20_000_000,
            failOn: "warning",
          }),
          meta = await decoder.metadata();
        if (meta.format !== "jpeg" || (meta.pages || 1) !== 1)
          return res
            .status(400)
            .json({ error: "Se requiere una foto JPEG válida." });
        const { data, info } = await decoder
          .rotate()
          .resize({
            width: 1280,
            height: 1280,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 80 })
          .toBuffer({ resolveWithObject: true });
        if (data.length > ENTRANCE_PHOTO_MAX_BYTES)
          return res
            .status(400)
            .json({ error: "La foto es demasiado grande." });
        const sha256 = crypto.createHash("sha256").update(data).digest("hex"),
          sourceId = req.get("X-Photo-Id")!;
        const existing = photos.read(order.id);
        if (existing)
          return existing.sourceId === sourceId && existing.sha256 === sha256
            ? res.json({ attached: true, replayed: true })
            : res
                .status(409)
                .json({
                  error: "La foto de este pedido ya está confirmada.",
                  code: "PHOTO_ALREADY_ATTACHED",
                });
        // Recheck after asynchronous decoding; attaching evidence never reopens a closed order.
        if (
          ["ENTREGADO", "CANCELADO", "DEVUELTO"].includes(
            orders.getOrderById(order.id)!.fulfillmentStatus,
          )
        )
          return res
            .status(409)
            .json({
              error: "El pedido está cerrado. Su foto no se puede cambiar.",
              code: "PHOTO_ORDER_CLOSED",
            });
        const saved = photos.commit({
          version: 1,
          orderId: order.id,
          sourceId,
          sha256,
          jpeg: data.toString("base64"),
          width: info.width,
          height: info.height,
          createdAt: new Date().toISOString(),
          actor: (req as any).adminSession
            ? `ADMINISTRADOR:${(req as any).adminSession.userId}`
            : "TITULAR_COMPRA",
          destinationKey,
        });
        if (
          saved.record.sourceId !== sourceId ||
          saved.record.sha256 !== sha256
        )
          return res
            .status(409)
            .json({
              error: "La foto de este pedido ya está confirmada.",
              code: "PHOTO_ALREADY_ATTACHED",
            });
        return res
          .status(saved.created ? 201 : 200)
          .json({ attached: true, replayed: !saved.created });
      } catch {
        return res
          .status(400)
          .json({
            error:
              "No pudimos guardar esta foto. Tu pedido permanece confirmado; puedes reintentar la foto.",
          });
      }
    },
  );
  app.get(
    "/api/v1/driver/dispatches/:dispatchId/entrance-photo",
    (req, res) => {
      const id = dispatch.authenticate(
        req.get("Authorization")?.replace(/^Bearer /, "") || "",
      );
      const run = orders.dispatchState.runs[req.params.dispatchId];
      if (
        !id ||
        !run ||
        run.driverId !== id ||
        !["ASSIGNED", "PICKED_UP", "INCIDENT"].includes(run.status) ||
        (run.transfer?.releasedAt && !run.transfer.acceptedAt)
      )
        return unavailable(res);
      return serve(res, run.orderId);
    },
  );
}
