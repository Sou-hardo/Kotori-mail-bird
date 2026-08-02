/* eslint-disable */
/**
 * Generated-style function references. Run `convex codegen` after linking a
 * deployment to regenerate this file and component references.
 */
import type * as aiActions from "../aiActions.js";
import type * as aiData from "../aiData.js";
import type * as domain from "../domain.js";
import type * as gmailActions from "../gmailActions.js";
import type * as gmailData from "../gmailData.js";
import type * as health from "../health.js";
import type * as jobActions from "../jobActions.js";
import type * as jobs from "../jobs.js";
import type * as pushActions from "../pushActions.js";
import type * as pushData from "../pushData.js";
import type * as reminders from "../reminders.js";
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi } from "convex/server";

declare const fullApi: ApiFromModules<{
  aiActions: typeof aiActions;
  aiData: typeof aiData;
  domain: typeof domain;
  gmailActions: typeof gmailActions;
  gmailData: typeof gmailData;
  health: typeof health;
  jobActions: typeof jobActions;
  jobs: typeof jobs;
  pushActions: typeof pushActions;
  pushData: typeof pushData;
  reminders: typeof reminders;
}>;

export const api = anyApi as FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export const internal = anyApi as FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
// Component references require a linked deployment's generated component API.
export const components = anyApi;
