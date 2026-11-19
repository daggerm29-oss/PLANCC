import { Router, type IRouter } from "express";
import type { HealthStatus } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" } satisfies HealthStatus);
});

export default router;
