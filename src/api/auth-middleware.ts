import { auth } from "../auth/server";

const DEV_USER_ID = "__dev_local_user__";
const DEMO_USER_ID = "__demo_user__";
const isDev = process.env.NODE_ENV !== "production";
const isDemoMode = process.env.DEMO_MODE === "true";

export function requireAuth(handler: (req: any, res: any, userId: string) => Promise<void>) {
  return async (req: any, res: any) => {
    try {
      // Demo mode bypass: skip auth entirely for HR demos
      if (isDemoMode) {
        return handler(req, res, DEMO_USER_ID);
      }

      // Development bypass: allow requests with x-dev-bypass header
      if (isDev && req.headers["x-dev-bypass"] === "1") {
        console.log("[Auth] Development bypass enabled");
        return handler(req, res, DEV_USER_ID);
      }

      const session = await auth.api.getSession({ headers: req.headers });
      const userId = session?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return handler(req, res, userId);
    } catch (error) {
      console.error("[Auth] Session verification failed:", error);
      return res.status(401).json({ error: "Unauthorized" });
    }
  };
}

export default { requireAuth };
