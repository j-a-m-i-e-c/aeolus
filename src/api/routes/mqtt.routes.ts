// src/api/routes/mqtt.routes.ts — MQTT publish endpoint (confined by publish policy)

import { Router } from "express";
import type { MqttService } from "../../mqtt/mqtt-service.js";
import {
  BadRequestError,
  ForbiddenError,
  PayloadTooLargeError,
} from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { validate } from "../middleware/validate.js";
import { publishBodySchema } from "../schemas/mqtt.schemas.js";
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

  return router;
}
