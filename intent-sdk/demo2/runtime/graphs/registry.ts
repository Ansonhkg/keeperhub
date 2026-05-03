import { evalExecPrepareGraphManifest } from "../../core/graphs/eval-exec.prepare/graph.ts";
import { evalExecRunGraphManifest } from "../../core/graphs/eval-exec.run/graph.ts";

export const evalExecV3GraphManifests = [
  evalExecPrepareGraphManifest,
  evalExecRunGraphManifest,
];

export const evalExecV3GraphManifestByKey = Object.fromEntries(
  evalExecV3GraphManifests.map((manifest) => [manifest.key, manifest])
);

export function getEvalExecV3GraphManifest(graphKey: string) {
  return evalExecV3GraphManifestByKey[graphKey];
}
