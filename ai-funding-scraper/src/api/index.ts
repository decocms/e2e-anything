import dashboard from "../dashboard.html";
import { buildRoutes } from "./routes";

const PORT = parseInt(process.env.PORT || "3000");

const routes = buildRoutes(dashboard);

const server = Bun.serve({
  port: PORT,
  routes,
  fetch(req) {
    // Fallback for unmatched routes
    return Response.json({ error: "Not found" }, { status: 404 });
  },
  error(error) {
    console.error("Server error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`\n🚀 AI Funding Tracker running at ${server.url}`);
console.log(`   Dashboard: ${server.url}`);
console.log(`   API: ${server.url}api/stats`);
console.log(`   Export: ${server.url}api/export/csv\n`);
