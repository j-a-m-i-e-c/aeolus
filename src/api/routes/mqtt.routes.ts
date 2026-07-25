// src/api/routes/mqtt.routes.ts — MQTT publish endpoint (confined by publish policy)

import { Router } from "express";
import type { MqttService } from "../../mqtt/mqtt-service.js";
import type { PrivateTopicStore } from "../../mqtt/private-topic-store.js";
import {
  BadRequestError,
  ForbiddenError,
  PayloadTooLargeError,
} from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { validate } from "../middleware/validate.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import { publishBodySchema, privateTopicBodySchema } from "../schemas/mqtt.schemas.js";
import { evaluatePublish, type PublishPolicyConfig } from "../../mqtt/publish-policy.js";
import logger from "../../logger.js";

/**
 * Create the MQTT routes. The raw publish endpoint is confined by the
 * server-side publish policy: authorization derives from the target topic and
 * the caller's role only. `authenticate` runs globally, so an unauthenticated
 * request is rejected with 401 before reaching this handler.
 */
export function createMqttRoutes(
  mqttService: MqttService,
  policyConfig: PublishPolicyConfig,
  privateTopicStore: PrivateTopicStore,
): Router {
  const router = Router();

  /** POST /api/mqtt/publish — publish a message to the MQTT broker (confined) */
  router.post(
    "/publish",
    validate({ body: publishBodySchema }),
    asyncHandler((req, res) => {
      const { topic, payload, retain } = req.body as {
        topic: string;
        payload?: unknown;
        retain?: boolean;
      };
      const cleanTopic = topic.trim();

      // Serialize exactly as before: string payloads verbatim, else JSON.
      const message = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
      const payloadBytes = Buffer.byteLength(message);

      const role = req.user?.role ?? "user";
      const wantRetain = retain ?? false;

      const decision = evaluatePublish(
        { role, topic: cleanTopic, retain: wantRetain, payloadBytes },
        policyConfig,
      );

      if (!decision.allow) {
        logger.warn(
          { userId: req.user?.userId, role, topic: cleanTopic, reason: decision.reason },
          "Raw MQTT publish denied",
        );
        switch (decision.status) {
          case 400:
            throw new BadRequestError(decision.reason);
          case 413:
            throw new PayloadTooLargeError(decision.reason);
          default:
            throw new ForbiddenError(decision.reason);
        }
      }

      mqttService.publish(cleanTopic, message, { retain: wantRetain });

      logger.info(
        { topic: cleanTopic, payloadLength: payloadBytes, retain: wantRetain, role },
        "MQTT message published via API",
      );
      res.json({ success: true, topic: cleanTopic });
    }),
  );

  // --- Private topic filters ----------------------------------------------
  // The raw MQTT inspector feed is broadcast to every authenticated client.
  // These filters carve out sensitive topics: a message whose topic matches any
  // registered filter is withheld from non-admins. Marking a topic private
  // (add) and viewing the list are open to any authenticated user because they
  // only ever *hide* data — the safe direction. Removing a filter re-exposes a
  // topic, so DELETE stays admin-only.

  /** GET /api/mqtt/private-topics — list the private topic filters */
  router.get(
    "/private-topics",
    asyncHandler((_req, res) => {
      res.json({ topics: privateTopicStore.list() });
    }),
  );

  /** POST /api/mqtt/private-topics — register a private topic filter */
  router.post(
    "/private-topics",
    validate({ body: privateTopicBodySchema }),
    asyncHandler((req, res) => {
      const { pattern } = req.body as { pattern: string };
      const topic = privateTopicStore.add(pattern);
      logger.info({ userId: req.user?.userId, pattern: topic.pattern }, "MQTT topic marked private");
      res.status(201).json({ topic });
    }),
  );

  /** DELETE /api/mqtt/private-topics/:id — remove a private topic filter (admin only) */
  router.delete(
    "/private-topics/:id",
    requireAdmin,
    asyncHandler((req, res) => {
      const id = req.params.id as string;
      const removed = privateTopicStore.remove(id);
      if (!removed) {
        throw new BadRequestError("Private topic filter not found");
      }
      logger.info({ userId: req.user?.userId, id }, "MQTT private topic filter removed");
      res.json({ success: true });
    }),
  );

  return router;
}
