import { logServerError } from "../utils/safe-logger.utils.js";

type MainOptions = {
  start?: () => Promise<unknown>;
  setExitCode?: (code: number) => void;
};

export const main = async ({
  start,
  setExitCode = (code) => { process.exitCode = code; },
}: MainOptions = {}) => {
  try {
    const startRuntime = start ?? (await import("./start-server.js")).startServer;
    await startRuntime();
  } catch (error) {
    logServerError("Backend startup failed.", error);
    setExitCode(1);
  }
};
