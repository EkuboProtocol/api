import { app } from "./router";
import { createWorker } from "./worker";

export default createWorker(app);
