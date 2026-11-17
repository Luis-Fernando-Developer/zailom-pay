import Fastify from "fastify";
import cors from "@fastify/cors";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const { Pool } = pg;
const app = Fastify({
  logger: true,
  trustProxy: process.env.TRUST_PROXY === "true",
  bodyLimit: 1024 * 1024,
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const appOrigin = new URL(process.env.APP_ORIGIN ?? "http://localhost:5173").origin;
const apiPublicUrl = process.env.API_PUBLIC_URL ?? "http://localhost:3001";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

async function runMigrations() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationPath = resolve(currentDir, "../../database/migrations/001_financial_foundation.sql");
  const migrationSql = await readFile(migrationPath, "utf8");
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [7319041701]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.zp_schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const version = "001_financial_foundation";
    const applied = await client.query(
      "SELECT 1 FROM public.zp_schema_migrations WHERE version = $1",
      [version],
    );

    if (applied.rowCount === 0) {
      await client.query("BEGIN");
      try {
        await client.query(migrationSql);
        await client.query(
          "INSERT INTO public.zp_schema_migrations (version) VALUES ($1)",
          [version],
        );
        await client.query("COMMIT");
        app.log.info({ migration: version }, "Database migration applied");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } else {
      app.log.info({ migration: version }, "Database migration already applied");
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [7319041701]);
    } finally {
      client.release();
    }
  }
}

await app.register(cors, {
  origin: [appOrigin],
  credentials: true,
});

app.get("/", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Zailom Pay</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #090b10; color: #f4f6fb; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; }
    main { width: min(560px, 100%); padding: 36px; border: 1px solid #252a36; border-radius: 24px; background: linear-gradient(145deg, #141925, #0d1018); }
    .mark { color: #8ee3c1; font-size: 13px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
    h1 { margin: 18px 0 10px; font-size: clamp(32px, 7vw, 48px); letter-spacing: -.05em; }
    p { color: #a8b0c0; line-height: 1.65; }
    .status { display: inline-flex; align-items: center; gap: 9px; margin-top: 18px; padding: 9px 12px; border-radius: 999px; background: #142c27; color: #a7efd5; font-size: 13px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #6de0b4; }
  </style>
</head>
<body>
  <main>
    <div class="mark">Zailom Financial</div>
    <h1>Zailom Pay</h1>
    <p>A infraestrutura financeira do ecossistema Zailom. O núcleo da API está no ar; o painel e os módulos financeiros serão construídos sobre esta base.</p>
    <div class="status"><span class="dot"></span> Serviço inicial ativo</div>
  </main>
</body>
</html>`);
});

app.get("/health", async (_request, reply) => {
  try {
    await pool.query("SELECT 1");
    return { success: true, service: "zailom-pay", status: "healthy" };
  } catch (error) {
    app.log.error({ err: error }, "Database health check failed");
    return reply.code(503).send({
      success: false,
      service: "zailom-pay",
      status: "database_unavailable",
    });
  }
});

app.get("/api/v1/status", async () => ({
  service: "zailom-pay",
  version: "0.1.0",
  environment: process.env.NODE_ENV ?? "development",
  api: apiPublicUrl,
}));

app.addHook("onClose", async () => {
  await pool.end();
});

try {
  await runMigrations();
  await app.listen({ port, host });
} catch (error) {
  app.log.error({ err: error }, "Failed to start Zailom Pay");
  await pool.end();
  process.exit(1);
}
