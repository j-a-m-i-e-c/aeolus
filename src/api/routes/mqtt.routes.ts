// src/api/routes/mqtt.routes.ts — MQTT publish endpoint

import { Router } from "express";
import type { MqttService } from "../../mqtt/mqtt-service.js";
import { BadRequestError } from "../middleware/error-handler.js";
import logger from "../../logger.js";

export function createMqttRoutes(mqttService: MqttService): Router {
  const router = Router();

  /** POST /api/mqtt/publish — publish a message to the MQTT broker */
  router.post("/publish", (req, res, next) => {
    try {
      const { topic, payload } = req.body;

      if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
        throw new BadRequestError("topic is required and must be a non-empty string");
      }

      const message = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");

      mqttService.publish(topic.trim(), message);

      logger.info({ topic: topic.trim(), payloadLength: message.length }, "MQTT message published via API");
      res.json({ success: true, topic: topic.trim() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
