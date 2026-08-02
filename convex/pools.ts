import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

const retry = { maxAttempts: 5, initialBackoffMs: 2_000, base: 2 } as const;
export const syncPool = new Workpool(components.syncWorkpool, {
  maxParallelism: 2,
  retryActionsByDefault: true,
  defaultRetryBehavior: retry,
});
export const generalPool = new Workpool(components.generalWorkpool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: retry,
});
