import { query } from "./_generated/server";
export const ready = query({ args: {}, handler: () => ({ status: "ready" }) });
