import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();
app.use(betterAuth, { name: "betterAuth" });
app.use(workpool, { name: "syncWorkpool" });
app.use(workpool, { name: "generalWorkpool" });
export default app;
