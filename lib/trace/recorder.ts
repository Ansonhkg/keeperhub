import { getKeeperTraceProviders } from "./providers";

export function getTraceRecorder() {
  return getKeeperTraceProviders().recorder;
}
