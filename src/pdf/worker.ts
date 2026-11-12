// worker.ts — module-worker entry for the PDF builds (#713). Spawned and torn
// down per job by offThread.ts's buildPdfOffThread.
import { serveBuild } from "@/offThread";
import { runPdfJob } from "./offThread";

serveBuild(runPdfJob);
