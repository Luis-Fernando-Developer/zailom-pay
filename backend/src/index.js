import Fastify from "fastify";
import cors from "@fastify/cors";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bootstrapAdmin, getCurrentUser, registerAuthRoutes } from "./auth.js";

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
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

async function runMigrations() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrations = ["001_financial_foundation", "002_authentication"];
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [7319041701]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.zp_schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const version of migrations) {
      const applied = await client.query(
        "SELECT 1 FROM public.zp_schema_migrations WHERE version = $1",
        [version],
      );
      if (applied.rowCount > 0) {
        app.log.info({ migration: version }, "Database migration already applied");
        continue;
      }

      const migrationPath = resolve(currentDir, "../database/migrations", `${version}.sql`);
      const migrationSql = await readFile(migrationPath, "utf8");
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
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [7319041701]);
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


app.get("/panel", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel | Zailom Pay</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#090b10;color:#f4f6fb}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 15% 0%,#17332e 0,transparent 42%),#090b10}
main{width:min(1080px,100%);margin:auto;padding:28px 22px}.brand{color:#8ee3c1;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 0 30px}h1{font-size:clamp(30px,5vw,46px);letter-spacing:-.05em;margin:12px 0}p{color:#a8b0c0;line-height:1.6}
.card{border:1px solid #252d38;border-radius:20px;background:#111720;padding:26px;max-width:460px;margin:7vh auto}
input{width:100%;padding:14px;margin:7px 0 13px;border-radius:10px;border:1px solid #35404d;background:#0b1017;color:#fff;font:inherit}
button{border:0;border-radius:10px;padding:13px 18px;background:#8ee3c1;color:#092019;font-weight:800;cursor:pointer}
button.secondary{background:#202a35;color:#e7edf5}.muted{color:#94a0b1;font-size:13px}.error{color:#ff9a9a;min-height:22px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-top:24px}
.tile{padding:22px;border:1px solid #252d38;border-radius:16px;background:#111720}.tile strong{display:block;margin-bottom:8px}.hidden{display:none}
</style></head><body><main>
<header><div><div class="brand">Zailom Financial</div><div class="muted">Console administrativo</div></div><button id="logout" class="secondary hidden">Sair</button></header>
<section id="login" class="card"><div class="brand">Acesso restrito</div><h1>Entrar no Pay</h1><p>Use as credenciais administrativas configuradas para esta instância.</p>
<form id="loginForm"><label for="email">E-mail</label><input id="email" type="email" autocomplete="username" required>
<label for="password">Senha</label><input id="password" type="password" autocomplete="current-password" required>
<button type="submit">Entrar</button><div id="error" class="error" role="alert"></div></form></section>
<section id="dashboard" class="hidden"><div class="brand">Visão geral</div><h1>Bem-vindo, <span id="name">administrador</span>.</h1><p>O ambiente administrativo está autenticado. Os módulos financeiros serão liberados conforme forem implementados.</p>
<div class="grid"><div class="tile"><strong>Contas e empresas</strong><span class="muted">Estrutura preparada na base de dados.</span></div><div class="tile"><strong>Ledger</strong><span class="muted">Fundação contábil criada; operações ainda não habilitadas.</span></div><div class="tile"><strong>Provedores</strong><span class="muted">Integração Z2PAY será conectada após definição do contrato e API.</span></div></div>
<p class="muted" id="identity"></p></section></main>
<script>
const login=document.querySelector("#login"),dashboard=document.querySelector("#dashboard"),logout=document.querySelector("#logout"),error=document.querySelector("#error");
async function api(path,options={}){const response=await fetch(path,{...options,credentials:"same-origin",headers:{"content-type":"application/json",...(options.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Não foi possível concluir a operação.");return data}
function show(user){login.classList.add("hidden");dashboard.classList.remove("hidden");logout.classList.remove("hidden");document.querySelector("#name").textContent=user.displayName;document.querySelector("#identity").textContent=user.email+" · "+user.role}
document.querySelector("#loginForm").addEventListener("submit",async event=>{event.preventDefault();error.textContent="";try{const result=await api("/api/v1/auth/login",{method:"POST",body:JSON.stringify({email:document.querySelector("#email").value,password:document.querySelector("#password").value})});show(result.user)}catch(err){error.textContent=err.message}});
logout.addEventListener("click",async()=>{await api("/api/v1/auth/logout",{method:"POST"});dashboard.classList.add("hidden");login.classList.remove("hidden");logout.classList.add("hidden")});
api("/api/v1/auth/me").then(result=>show(result.user)).catch(()=>{});
</script></body></html>`);
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
  await bootstrapAdmin(pool, app.log);
  await registerAuthRoutes(app, pool);
  await app.listen({ port, host });
} catch (error) {
  app.log.error({ err: error }, "Failed to start Zailom Pay");
  await pool.end();
  process.exit(1);
}
