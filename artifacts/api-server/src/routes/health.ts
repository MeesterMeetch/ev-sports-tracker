import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Service root: deployment healthchecks and uptime monitors probe the bare
// /api path prefix. Without this route Express returns 404, which monitors
// count as downtime even when the server is healthy.
router.get("/", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
