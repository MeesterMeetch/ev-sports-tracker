import { Router, type IRouter } from "express";
import healthRouter from "./health";
import oddsRouter from "./odds";
import betsRouter from "./bets";
import analysisRouter from "./analysis";
import emailRouter from "./email";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(oddsRouter);
router.use(betsRouter);
router.use(analysisRouter);
router.use(emailRouter);
router.use(authRouter);

export default router;
