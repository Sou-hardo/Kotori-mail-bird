import {
  actionGeneric,
  httpActionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import type { DataModel } from "./dataModel.js";
export const query = queryGeneric as ReturnType<typeof queryGeneric<DataModel>>;
export const internalQuery = internalQueryGeneric as ReturnType<
  typeof internalQueryGeneric<DataModel>
>;
export const mutation = mutationGeneric as ReturnType<
  typeof mutationGeneric<DataModel>
>;
export const internalMutation = internalMutationGeneric as ReturnType<
  typeof internalMutationGeneric<DataModel>
>;
export const action = actionGeneric as ReturnType<
  typeof actionGeneric<DataModel>
>;
export const internalAction = internalActionGeneric as ReturnType<
  typeof internalActionGeneric<DataModel>
>;
export const httpAction = httpActionGeneric;
export type {
  GenericActionCtx as ActionCtx,
  GenericMutationCtx as MutationCtx,
  GenericQueryCtx as QueryCtx,
} from "convex/server";
