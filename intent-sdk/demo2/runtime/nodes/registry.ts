import { prepareNodeManifest } from "../../core/nodes/operation.eval-exec.prepare/node.manifest.ts";
import { runOperationNodeManifests } from "../../core/nodes/operation.eval-exec.workflow-nodes/node.manifest.ts";

export const evalExecV3NodeManifests = [
  prepareNodeManifest,
  ...runOperationNodeManifests,
];

export const evalExecV3NodeManifestByKey = Object.fromEntries(
  evalExecV3NodeManifests.map((manifest) => [manifest.key, manifest])
);

export function getEvalExecV3NodeManifest(nodeKey: string) {
  return evalExecV3NodeManifestByKey[nodeKey];
}
