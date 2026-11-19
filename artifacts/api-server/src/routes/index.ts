import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import proxyRouter from "./proxy.js";
import cctvRouter from "./cctv.js";
import configRouter from "./config.js";
import trafficRouter from "./traffic.js";
import infrastructureRouter from "./infrastructure.js";
import launchesRouter from "./launches.js";
import aiRouter from "./ai.js";
import eventsRouter from "./events.js";
import signalsRouter from "./signals.js";
import imageryRouter from "./imagery.js";

const router: IRouter = Router();
router.use(aiRouter);
router.use(eventsRouter);
router.use(signalsRouter);
router.use(imageryRouter);
router.use(launchesRouter);

router.use(configRouter);
router.use(healthRouter);
router.use(proxyRouter);
router.use(cctvRouter);
router.use(trafficRouter);
router.use(infrastructureRouter);

export default router;
