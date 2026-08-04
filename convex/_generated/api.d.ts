/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiActions from "../aiActions.js";
import type * as aiData from "../aiData.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as crypto from "../crypto.js";
import type * as domain from "../domain.js";
import type * as gmailActions from "../gmailActions.js";
import type * as gmailData from "../gmailData.js";
import type * as gmailSync from "../gmailSync.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as jobActions from "../jobActions.js";
import type * as jobs from "../jobs.js";
import type * as mailCrypto from "../mailCrypto.js";
import type * as migrations from "../migrations.js";
import type * as pools from "../pools.js";
import type * as principal from "../principal.js";
import type * as pushActions from "../pushActions.js";
import type * as pushData from "../pushData.js";
import type * as quota from "../quota.js";
import type * as reminders from "../reminders.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiActions: typeof aiActions;
  aiData: typeof aiData;
  auth: typeof auth;
  crons: typeof crons;
  crypto: typeof crypto;
  domain: typeof domain;
  gmailActions: typeof gmailActions;
  gmailData: typeof gmailData;
  gmailSync: typeof gmailSync;
  health: typeof health;
  http: typeof http;
  jobActions: typeof jobActions;
  jobs: typeof jobs;
  mailCrypto: typeof mailCrypto;
  migrations: typeof migrations;
  pools: typeof pools;
  principal: typeof principal;
  pushActions: typeof pushActions;
  pushData: typeof pushData;
  quota: typeof quota;
  reminders: typeof reminders;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  syncWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"syncWorkpool">;
  generalWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"generalWorkpool">;
};
