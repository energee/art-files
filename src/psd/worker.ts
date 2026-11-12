// worker.ts — module-worker entry for the PSD build (#415). Spawned and torn
// down per job by offThread.ts's buildPsdOffThread.
import { serveBuild } from "@/offThread";
import { runPsdJob } from "./offThread";

serveBuild(runPsdJob);
