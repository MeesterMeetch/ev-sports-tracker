import { Router, type IRouter } from "express";
import healthRouter from "./health";
import oddsRouter from "./odds";
import betsRouter from "./bets";
import analysisRouter from "./analysis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(oddsRouter);
router.use(betsRouter);
router.use(analysisRouter);

export default router;
