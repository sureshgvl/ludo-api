export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ludo",
  // Shared secrets. When empty, the matching endpoints reject every request.
  adminApiKey: process.env.ADMIN_API_KEY ?? "",
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  // Secret for signing player login tokens; must equal JWT_SECRET on ludo-game-server. When empty, login is off and userId is trusted (dev only).
  jwtSecret: process.env.JWT_SECRET ?? "",
  // OAuth client ID(s) of your Google Cloud project, comma separated (web + Android). Empty = Google login off.
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean),
  // New accounts allowed per IP per day (cheap guard against account farming).
  maxSignupsPerIpPerDay: Number(process.env.MAX_SIGNUPS_PER_IP_PER_DAY ?? 5),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS ?? 10000),
  disableScheduler: process.env.DISABLE_SCHEDULER === "true",
};
