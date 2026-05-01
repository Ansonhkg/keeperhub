import { z } from "zod";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

const recordSchema = z.record(z.string(), jsonValueSchema);

export const dagCommitSchema = z.object({
  id: z.string().min(1),
  parentIds: z.array(z.string().min(1)),
  patch: jsonValueSchema,
  createdAt: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  metadata: recordSchema.optional(),
});

export const dagBranchSchema = z.object({
  id: z.string().min(1),
  baseCommitId: z.string().min(1),
  patch: jsonValueSchema,
  metadata: jsonValueSchema,
  status: z.enum(["open", "rejected", "selected", "stale"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  selectedCommitId: z.string().min(1).optional(),
  rejectionReason: z.string().min(1).optional(),
  staleReason: z.string().min(1).optional(),
});

export const dagSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    commits: z.array(dagCommitSchema),
    branches: z.array(dagBranchSchema),
    headCommitId: z.string().min(1).optional(),
    revision: z.number().int().nonnegative(),
  })
  .superRefine((session, context) => {
    const commitIds = new Set<string>();
    for (const commit of session.commits) {
      if (commitIds.has(commit.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate commit: ${commit.id}`,
          path: ["commits"],
        });
      }
      commitIds.add(commit.id);
    }
    for (const commit of session.commits) {
      for (const parentId of commit.parentIds) {
        if (!commitIds.has(parentId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown parent: ${parentId}`,
            path: ["commits"],
          });
        }
      }
    }
    if (session.headCommitId && !commitIds.has(session.headCommitId)) {
      context.addIssue({
        code: "custom",
        message: `Unknown head: ${session.headCommitId}`,
        path: ["headCommitId"],
      });
    }
    const branchIds = new Set<string>();
    for (const branch of session.branches) {
      if (branchIds.has(branch.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate branch: ${branch.id}`,
          path: ["branches"],
        });
      }
      branchIds.add(branch.id);
      if (!commitIds.has(branch.baseCommitId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown branch base: ${branch.baseCommitId}`,
          path: ["branches"],
        });
      }
      if (branch.status === "selected" && !branch.selectedCommitId) {
        context.addIssue({
          code: "custom",
          message: `Selected branch missing selectedCommitId: ${branch.id}`,
          path: ["branches"],
        });
      }
    }
  });

export function parseDagSession(
  input: unknown
): z.infer<typeof dagSessionSchema> {
  return dagSessionSchema.parse(input);
}
