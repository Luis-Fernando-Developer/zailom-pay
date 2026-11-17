import Fastify from "fastify";
import cors from "@fastify/cors";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bootstrapAdmin, registerAuthRoutes } from "./auth.js";
import { registerAdminRoutes } from "./admin.js";

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
    <p><a href="/panel" style="color:#8ee3c1;font-weight:700;text-decoration:none">Acessar painel administrativo →</a></p>
  </main>
</body>
</html>`);
});


app.get("/panel", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(\`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel | Zailom Pay</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#090b10;color:#f4f6fb}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 15% 0%,#17332e 0,transparent 42%),#090b10}
main{width:min(1120px,100%);margin:auto;padding:28px 22px}.brand{color:#8ee3c1;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 0 30px;gap:16px}h1{font-size:clamp(30px,5vw,46px);letter-spacing:-.05em;margin:12px 0}h2{font-size:18px;margin:0 0 16px}p{color:#a8b0c0;line-height:1.6}
.card{border:1px solid #252d38;border-radius:20px;background:#111720;padding:26px;max-width:460px;margin:7vh auto}
input{width:100%;padding:14px;margin:7px 0 13px;border-radius:10px;border:1px solid #35404d;background:#0b1017;color:#fff;font:inherit}
button{border:0;border-radius:10px;padding:13px 18px;background:#8ee3c1;color:#092019;font-weight:800;cursor:pointer}
button.secondary{background:#202a35;color:#e7edf5}.muted{color:#94a0b1;font-size:13px}.error{color:#ff9a9a;min-height:22px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:24px 0}
.tile,.section{padding:22px;border:1px solid #252d38;border-radius:16px;background:#111720}.tile span{display:block}.metric{font-size:30px;font-weight:750;letter-spacing:-.04em;margin:12px 0 5px}
.section{margin-top:18px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.pill{display:inline-flex;padding:6px 9px;border-radius:999px;background:#332b19;color:#f2d49a;font-size:12px}
.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}th,td{padding:13px 10px;border-bottom:1px solid #252d38;white-space:nowrap}th{color:#94a0b1;font-weight:600}td{color:#e7edf5}.empty{padding:22px;color:#94a0b1;text-align:center}
.hidden{display:none}.identity{margin-top:24px}.refresh{font-size:13px;color:#8ee3c1}
@media(max-width:560px){main{padding:18px 14px}header{padding-bottom:20px}.tile,.section{padding:17px}}
</style></head><body><main>
<header><div><div class="brand">Zailom Financial</div><div class="muted">Console administrativo</div></div><button id="logout" class="secondary hidden">Sair</button></header>
<section id="login" class="card"><div class="brand">Acesso restrito</div><h1>Entrar no Pay</h1><p>Use as credenciais administrativas configuradas para esta instância.</p>
<form id="loginForm"><label for="email">E-mail</label><input id="email" type="email" autocomplete="username" required>
<label for="password">Senha</label><input id="password" type="password" autocomplete="current-password" required>
<button type="submit">Entrar</button><div id="error" class="error" role="alert"></div></form></section>
<section id="dashboard" class="hidden">
<div class="brand">Visão geral</div><h1>Bem-vindo, <span id="name">administrador</span>.</h1>
<p>Resumo operacional do ecossistema financeiro Zailom.</p>
<div class="section-head"><span class="pill">Modo seguro · movimentação real desativada</span><span class="refresh" id="updated"></span></div>
<div class="grid">
<div class="tile"><span class="muted">Empresas cadastradas</span><div class="metric" id="orgTotal">—</div><span class="muted" id="orgActive">Carregando...</span></div>
<div class="tile"><span class="muted">Participantes</span><div class="metric" id="participantTotal">—</div><span class="muted" id="kycPending">Carregando...</span></div>
<div class="tile"><span class="muted">Lançamentos no ledger</span><div class="metric" id="ledgerTotal">—</div><span class="muted" id="ledgerPosted">Carregando...</span></div>
<div class="tile"><span class="muted">Repasses pendentes</span><div class="metric" id="payoutPending">—</div><span class="muted" id="payoutTotal">Carregando...</span></div>
<div class="tile"><span class="muted">Eventos de provedores</span><div class="metric" id="eventsTotal">—</div><span class="muted" id="eventsPending">Carregando...</span></div>
</div>
<div class="section"><div class="section-head"><h2>Atividade recente do ledger</h2><span class="muted">Últimos 8 registros</span></div>
<div class="table-wrap"><table><thead><tr><th>Evento</th><th>Descrição</th><th>Status</th><th>Data</th></tr></thead><tbody id="recentRows"><tr><td colspan="4" class="empty">Carregando...</td></tr></tbody></table></div></div>
<p class="muted identity" id="identity"></p><div id="dashboardError" class="error" role="alert"></div>
</section></main>
<script>
const login=document.querySelector("#login"),dashboard=document.querySelector("#dashboard"),logout=document.querySelector("#logout"),error=document.querySelector("#error");
async function api(path,options={}){const response=await fetch(path,{...options,credentials:"same-origin",headers:{"content-type":"application/json",...(options.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Não foi possível concluir a operação.");return data}
function escapeHtml(value){return String(value??"—").replace(/[&<>"']/g,function(char){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]})}
function show(user){login.classList.add("hidden");dashboard.classList.remove("hidden");logout.classList.remove("hidden");document.querySelector("#name").textContent=user.displayName;document.querySelector("#identity").textContent=user.email+" · "+user.role;loadOverview()}
async function loadOverview(){const errorBox=document.querySelector("#dashboardError");errorBox.textContent="";try{const data=await api("/api/v1/admin/overview");document.querySelector("#orgTotal").textContent=data.organizations.total;document.querySelector("#orgActive").textContent=data.organizations.active+" ativas";
document.querySelector("#participantTotal").textContent=data.participants.total;document.querySelector("#kycPending").textContent=data.participants.kyc_pending+" com KYC pendente";
document.querySelector("#ledgerTotal").textContent=data.ledger.total;document.querySelector("#ledgerPosted").textContent=data.ledger.posted+" contabilizados · "+data.ledger.draft+" em rascunho";
document.querySelector("#payoutPending").textContent=data.payouts.pending;document.querySelector("#payoutTotal").textContent=data.payouts.total+" solicitações no total";
document.querySelector("#eventsTotal").textContent=data.providerEvents.total;document.querySelector("#eventsPending").textContent=data.providerEvents.unprocessed+" aguardando processamento";
document.querySelector("#updated").textContent="Atualizado "+new Date(data.generatedAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
const rows=data.recentTransactions.map(function(item){return "<tr><td>"+escapeHtml(item.event_type)+"</td><td>"+escapeHtml(item.description)+"</td><td>"+escapeHtml(item.status)+"</td><td>"+escapeHtml(new Date(item.created_at).toLocaleString("pt-BR"))+"</td></tr>"}).join("");
document.querySelector("#recentRows").innerHTML=rows||'<tr><td colspan="4" class="empty">Nenhuma movimentação registrada ainda.</td></tr>';
}catch(err){errorBox.textContent="Não foi possível carregar os indicadores: "+err.message}}
document.querySelector("#loginForm").addEventListener("submit",async function(event){event.preventDefault();error.textContent="";try{const result=await api("/api/v1/auth/login",{method:"POST",body:JSON.stringify({email:document.querySelector("#email").value,password:document.querySelector("#password").value})});show(result.user)}catch(err){error.textContent=err.message}});
logout.addEventListener("click",async function(){await api("/api/v1/auth/logout",{method:"POST"});dashboard.classList.add("hidden");login.classList.remove("hidden");logout.classList.add("hidden")});
api("/api/v1/auth/me").then(function(result){show(result.user)}).catch(function(){});
</script></body></html>\`);
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
  await registerAdminRoutes(app, pool);
  await app.listen({ port, host });
} catch (error) {
  app.log.error({ err: error }, "Failed to start Zailom Pay");
  await pool.end();
  process.exit(1);
}
