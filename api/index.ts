import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../artifacts/api-server/src/app.js";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const rewrittenPath = url.searchParams.get("__worldview_path");
  url.searchParams.delete("__worldview_path");
  const pathname = url.pathname === "/api/index" && rewrittenPath
    ? `/api/${rewrittenPath.split("/").map(encodeURIComponent).join("/")}`
    : url.pathname;
  req.url = pathname + url.search;
  return app(req, res);
}
