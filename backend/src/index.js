import Fastify from "fastify";
import cors from "@fastify/cors";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bootstrapAdmin, registerAuthRoutes } from "./auth.js";
import { registerAdminRoutes } from "./admin.js";
import { registerLedgerRoutes } from "./ledger.js";
import { registerEntityRoutes } from "./entities.js";
import { registerWalletRoutes } from "./wallet.js";
import { registerFeeRoutes } from "./fees.js";
import { registerFeeManagementRoutes } from "./fee-management.js";

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
  const migrations = ["001_financial_foundation", "002_authentication", "003_immutable_ledger_transactions", "004_seed_default_chart_of_accounts", "005_platform_wallet", "006_fee_rules", "007_hierarchical_fee_management"];
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
  .checkline{display:flex;align-items:center;gap:10px;margin:14px 0;color:#c4ced9}.checkline input[type="checkbox"]{width:18px;min-width:18px;min-height:18px;height:18px;margin:0;accent-color:#8ee3c1}\n</style>
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


const panelHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel | Zailom Pay</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#090b10;color:#f4f6fb}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 15% 0%,#17332e 0,transparent 42%),#090b10}
main{width:auto;max-width:1440px;margin-left:258px;padding:28px 34px;transition:margin-left .22s ease}
.sidebar{position:fixed;z-index:30;inset:0 auto 0 0;width:238px;padding:22px 14px;background:#0d141b;border-right:1px solid #26313b;display:flex;flex-direction:column;transition:width .22s ease,transform .22s ease}
.side-brand{display:flex;align-items:center;gap:11px;padding:4px 7px 30px}.brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#8ee3c1;color:#092019;font-weight:900;font-size:20px}.side-brand-text{display:flex;flex-direction:column;gap:2px;flex:1}.side-brand-text strong{font-size:13px;letter-spacing:.13em}.side-brand-text small{font-size:10px;letter-spacing:.2em;color:#8ee3c1}.icon-btn{background:#1b2731;color:#dbe5eb;padding:7px 11px;font-size:19px}.side-label{font-size:10px;letter-spacing:.15em;color:#728092;padding:0 12px 12px}#mainNav{display:flex;flex-direction:column;gap:6px}.navBtn{display:flex;align-items:center;gap:13px;width:100%;padding:12px;border:1px solid transparent;border-radius:11px;background:transparent;color:#aab6c4;text-align:left;font-weight:600}.navBtn:hover{background:#18252b;color:#eff8f4}.navBtn.active{background:#17332e;border-color:#285344;color:#a7efd5}.nav-icon{width:22px;text-align:center;font-size:19px}.side-footer{margin-top:auto;padding:14px 12px;color:#8e9baa;font-size:12px;border-top:1px solid #26313b}.status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#6de0b4;margin-right:9px}
body.collapsed .sidebar{width:76px}body.collapsed main{margin-left:76px}body.collapsed .side-brand-text,body.collapsed .side-label,body.collapsed .nav-text,body.collapsed .side-footer{display:none}body.collapsed .side-brand{justify-content:center;flex-wrap:wrap;padding:4px 0 30px}body.collapsed .icon-btn{margin-top:8px}body.collapsed .navBtn{justify-content:center;padding:13px 6px}
.mobile-shade{display:none}.brand{color:#8ee3c1;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 0 30px;gap:16px}h1{font-size:clamp(30px,5vw,46px);letter-spacing:-.05em;margin:12px 0}h2{font-size:18px;margin:0 0 16px}p{color:#a8b0c0;line-height:1.6}
.card{border:1px solid #252d38;border-radius:20px;background:#111720;padding:26px;max-width:460px;margin:7vh auto}
input,select{width:100%;min-width:0;min-height:48px;padding:12px 44px 12px 14px;margin:7px 0 16px;border-radius:12px;border:1px solid #35404d;background-color:#0b1017;color:#f4f6fb;font:inherit;font-size:15px;line-height:1.35;outline:none;transition:border-color .18s ease,box-shadow .18s ease}
select{appearance:none;-webkit-appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238ee3c1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;background-size:16px}
input:focus,select:focus{border-color:#8ee3c1;box-shadow:0 0 0 3px #8ee3c122}
select option{background:#111923;color:#f4f6fb}
label{display:block;margin:10px 0 3px;color:#c4ced9;font-size:13px;font-weight:650}
.table-wrap select{width:auto;min-width:142px;min-height:40px;margin:0;padding:8px 34px 8px 11px;border-radius:9px;font-size:13px;background-position:right 10px center}
button{border:0;border-radius:10px;padding:13px 18px;background:#8ee3c1;color:#092019;font-weight:800;cursor:pointer}
button.secondary{background:#202a35;color:#e7edf5}.muted{color:#94a0b1;font-size:13px}.error{color:#ff9a9a;min-height:22px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:24px 0}
.tile,.section{padding:22px;border:1px solid #252d38;border-radius:16px;background:#111720}.tile span{display:block}.metric{font-size:30px;font-weight:750;letter-spacing:-.04em;margin:12px 0 5px}
.section{margin-top:18px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.pill{display:inline-flex;padding:6px 9px;border-radius:999px;background:#332b19;color:#f2d49a;font-size:12px}
.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}th,td{padding:13px 10px;border-bottom:1px solid #252d38;white-space:nowrap}th{color:#94a0b1;font-weight:600}td{color:#e7edf5}.empty{padding:22px;color:#94a0b1;text-align:center}
.hidden{display:none}.identity{margin-top:24px}.refresh{font-size:13px;color:#8ee3c1}
header{justify-content:flex-start}#menuToggle{display:none;margin-right:8px}
@media(max-width:760px){main,body.collapsed main{margin-left:0;padding:16px 14px}header{padding:10px 0 22px}#menuToggle{display:inline-flex}.sidebar,body.collapsed .sidebar{width:270px;transform:translateX(-100%)}body.mobile-open .sidebar{transform:translateX(0)}body.mobile-open .mobile-shade{display:block;position:fixed;inset:0;background:#0009;z-index:20}body.collapsed .side-brand-text,body.collapsed .side-label,body.collapsed .nav-text,body.collapsed .side-footer{display:initial}body.collapsed .side-brand{justify-content:flex-start}body.collapsed .navBtn{justify-content:flex-start;padding:12px}#collapseSide{display:none}}
@media(min-width:761px){#menuToggle{display:none}}
@media(max-width:560px){.tile,.section{padding:17px}.section-head{align-items:flex-start;flex-wrap:wrap}.section-head button{width:100%}.card{padding:22px;margin:4vh auto}input,select{min-height:52px;padding:14px 46px 14px 15px;margin:8px 0 18px;font-size:16px;border-radius:13px}.table-wrap select{min-height:42px;min-width:136px;padding:9px 32px 9px 10px;margin:0;font-size:13px}}

.fee-hero{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin:4px 0 22px}.fee-hero h1{margin:8px 0;font-size:clamp(32px,4vw,44px)}.fee-hero p{margin:0}.fee-priority{padding:16px 19px;border:1px solid #315348;border-radius:15px;background:linear-gradient(105deg,#142b27,#121b22 75%);display:flex;flex-wrap:wrap;align-items:center;gap:10px 22px;margin-bottom:20px}.fee-priority>strong{font-size:10px;letter-spacing:.13em;color:#a7efd5}.fee-priority>div{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.fee-priority span{font-size:13px;font-weight:750;color:#eff8f3}.fee-priority b{color:#8ee3c1}.fee-priority small{flex-basis:100%;color:#9caeaa;font-size:12px}.fee-tabs{display:flex;gap:6px;overflow-x:auto;padding:5px;margin:0 0 18px;border:1px solid #28343b;border-radius:14px;background:#0c1218}.fee-tab{flex:0 0 auto;background:transparent;color:#9eacb8;padding:11px 15px;border:1px solid transparent;border-radius:10px;font-size:13px}.fee-tab.active{background:#d9f5e9;color:#10251e;border-color:#b3e8d2}.fee-panel{display:none}.fee-panel.active{display:block}.fee-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.fee-stat{padding:19px;border:1px solid #2a373b;border-radius:16px;background:linear-gradient(145deg,#182720,#111820)}.fee-stat span,.fee-stat small{display:block;color:#9eafa9;font-size:12px}.fee-stat strong{display:block;font-size:30px;margin:8px 0 4px;color:#effaf5}.fee-overview-card{display:grid;grid-template-columns:1.05fr .95fr;gap:28px;max-width:none}.fee-overview-card h2{font-size:22px;line-height:1.25}.fee-levels{display:grid;gap:9px}.fee-levels>div{display:flex;align-items:center;gap:13px;padding:12px;border-radius:12px;background:#0d151b;border:1px solid #27343a}.fee-levels>div>b{color:#8ee3c1}.fee-levels strong,.fee-levels small{display:block}.fee-levels strong{font-size:13px}.fee-levels small{color:#92a19f;font-size:11px;margin-top:3px}.fee-note{display:flex;gap:12px;padding:15px 17px;margin-top:14px;border:1px solid #34433e;border-radius:13px;background:#121c1b}.fee-note>b{color:#8ee3c1}.fee-note p{margin:0;font-size:12px}.fee-sim-grid,.fee-sim-result{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 16px;max-width:760px}.fee-sim-result{gap:12px;margin:18px 0 12px}.fee-sim-result>div{padding:18px;border-radius:14px;background:#142720;border:1px solid #315348}.fee-sim-result span,.fee-sim-result strong{display:block}.fee-sim-result span{color:#a5b8af;font-size:12px}.fee-sim-result strong{font-size:26px;color:#baf0d8;margin-top:8px}.fee-sim-result small{grid-column:1/-1;color:#9caeb0}.fee-panel .section{max-width:none}.fee-panel .section form{max-width:920px}.fee-panel input:disabled{opacity:.42;cursor:not-allowed;background:#080c11}@media(max-width:900px){.fee-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fee-overview-card{grid-template-columns:1fr}}@media(max-width:600px){.fee-hero{align-items:flex-start;flex-direction:column}.fee-hero button{width:100%}.fee-priority{gap:9px}.fee-priority>div{gap:6px}.fee-priority span{font-size:11px}.fee-stat{padding:15px}.fee-stat strong{font-size:25px}.fee-sim-grid,.fee-sim-result{grid-template-columns:1fr}.fee-sim-result small{grid-column:auto}.fee-tab{padding:10px 12px}}
</style></head><body><div id="mobileShade" class="mobile-shade"></div><aside id="sidebar" class="sidebar hidden"><div class="side-brand"><span class="brand-mark">Z</span><div class="side-brand-text"><strong>ZAILOM</strong><small>FINANCIAL</small></div><button id="collapseSide" class="icon-btn" aria-label="Recolher menu">‹</button></div><div class="side-label">MENU PRINCIPAL</div><nav id="mainNav"><button class="navBtn" data-page="overview"><span class="nav-icon">⌂</span><span class="nav-text">Visão geral</span></button><button class="navBtn" data-page="organizations"><span class="nav-icon">▦</span><span class="nav-text">Empresas</span></button><button class="navBtn" data-page="participants"><span class="nav-icon">♙</span><span class="nav-text">Participantes</span></button><button class="navBtn" data-page="recipients"><span class="nav-icon">◇</span><span class="nav-text">Beneficiários</span></button><button class="navBtn" data-page="wallet"><span class="nav-icon">▣</span><span class="nav-text">Carteira</span></button><button class="navBtn" data-page="fees"><span class="nav-icon">％</span><span class="nav-text">Tarifas</span></button></nav><div class="side-footer"><span class="status-dot"></span><span class="nav-text">Ambiente seguro</span></div></aside><main>
<header><button id="menuToggle" class="secondary" aria-label="Abrir menu">☰</button><div><div class="brand">Zailom Financial</div><div class="muted">Console administrativo</div></div><button id="logout" class="secondary hidden">Sair</button></header>
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
</section><section id="organizationsPage" class="hidden"><div class="section-head"><div><div class="brand">CADASTRO</div><h1>Empresas</h1><p>Gerencie as empresas cadastradas.</p></div><button id="newOrg">Nova empresa</button></div><form id="orgForm" class="section hidden"><h2>Nova empresa</h2><label>Razão social</label><input name="legalName" required><label>Nome fantasia</label><input name="tradeName"><label>CPF/CNPJ</label><input name="taxId"><button>Salvar</button></form><div class="section"><div class="section-head"><h2>Empresas</h2><button class="secondary" id="orgReload">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Participantes</th><th>Status</th><th></th></tr></thead><tbody id="orgRows"></tbody></table></div></div></section>
<section id="participantsPage" class="hidden"><div class="section-head"><div><div class="brand">CADASTRO</div><h1>Participantes</h1><p>Profissionais, empresas e outros participantes.</p></div><button id="newParticipant">Novo participante</button></div><form id="participantForm" class="section hidden"><h2>Novo participante</h2><label>Nome</label><input name="displayName" required><label>E-mail</label><input name="email" type="email"><label>CPF/CNPJ</label><input name="taxId"><label>Tipo</label><select name="participantType"><option value="professional">Profissional</option><option value="company">Empresa</option><option value="platform">Plataforma</option><option value="other">Outro</option></select><label>Empresa</label><select name="organizationId" id="orgSelect"><option value="">Sem vínculo</option></select><button>Salvar participante</button></form><div class="section"><div class="section-head"><h2>Participantes</h2><button class="secondary" id="participantReload">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Empresa</th><th>KYC</th><th>Status</th><th></th></tr></thead><tbody id="participantRows"></tbody></table></div></div></section>
<section id="recipientsPage" class="hidden"><div class="brand">PROVEDORES</div><h1>Beneficiários</h1><p>Vínculos de participantes com provedores financeiros.</p><div class="section"><h2>Vincular beneficiário</h2><form id="recipientForm"><label>Participante</label><select name="participantId" id="recipientSelect" required></select><label>Provedor</label><input name="providerCode" value="z2pay" required><label>ID externo (se houver)</label><input name="externalRecipientId"><label>Onboarding</label><select name="onboardingStatus"><option value="not_started">Não iniciado</option><option value="pending">Pendente</option><option value="under_review">Em análise</option><option value="approved">Aprovado</option><option value="rejected">Rejeitado</option><option value="action_required">Ação necessária</option><option value="blocked">Bloqueado</option></select><label>KYC</label><select name="kycStatus"><option value="not_started">Não iniciado</option><option value="pending">Pendente</option><option value="under_review">Em análise</option><option value="approved">Aprovado</option><option value="rejected">Rejeitado</option><option value="action_required">Ação necessária</option><option value="suspended">Suspenso</option></select><button>Salvar vínculo</button></form></div><div class="section"><div class="section-head"><h2>Beneficiários vinculados</h2><button class="secondary" id="recipientReload">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Participante</th><th>Provedor</th><th>ID externo</th><th>Onboarding</th><th>KYC</th></tr></thead><tbody id="recipientRows"></tbody></table></div></div></section><section id="walletPage" class="hidden"><div class="section-head"><div><div class="brand">TESOURARIA ZAILOM</div><h1>Carteira</h1><p>Acompanhe os valores contabilizados da plataforma e as taxas arrecadadas.</p></div><button class="secondary" id="walletReload">Atualizar</button></div><div class="section-head"><span class="pill">Somente leitura · saques reais desativados</span><span class="muted" id="walletUpdated"></span></div><div class="grid"><div class="tile"><span class="muted">Saldo disponível no caixa</span><div class="metric" id="walletAvailable">R$ 0,00</div><span class="muted">Saldo contábil menos saques em processamento</span></div><div class="tile"><span class="muted">Taxas da Zailom</span><div class="metric" id="walletFees">R$ 0,00</div><span class="muted">Receita de tarifas lançada no ledger</span></div><div class="tile"><span class="muted">Aguardando liquidação</span><div class="metric" id="walletClearing">R$ 0,00</div><span class="muted">Valores registrados na conta do provedor</span></div><div class="tile"><span class="muted">Taxas do provedor</span><div class="metric" id="walletProviderFees">R$ 0,00</div><span class="muted">Despesas contabilizadas</span></div></div><div class="section"><h2>Transferir para conta bancária</h2><p>O fluxo de saque aparecerá aqui assim que a integração de transferências do provedor estiver habilitada. Por segurança, ainda não aceitamos dados bancários nem simulamos transferências.</p><button class="secondary" disabled style="opacity:.55;cursor:not-allowed">Saques temporariamente indisponíveis</button></div><div class="section"><div class="section-head"><h2>Histórico de saques</h2><span class="muted">Últimos 20 registros</span></div><div class="table-wrap"><table><thead><tr><th>Solicitação</th><th>Destino</th><th>Valor</th><th>Status</th><th>Data</th></tr></thead><tbody id="walletRows"><tr><td colspan="5" class="empty">Carregando...</td></tr></tbody></table></div></div><div class="error" id="walletError" role="alert"></div></section><section id="feesPage" class="hidden"><div class="fee-hero"><div><div class="brand">CENTRAL FINANCEIRA · ZAILOM PAY</div><h1>Tarifas</h1><p>Defina, organize e simule as condições comerciais de todo o ecossistema.</p></div><button class="secondary" id="feeReload">↻ Atualizar dados</button></div><div class="fee-priority"><strong>HIERARQUIA</strong><div><span>Exceção individual</span><b>›</b><span>Grupo comercial</span><b>›</b><span>Tarifa padrão</span></div><small>A regra ativa mais específica prevalece. Lançamentos já registrados não são alterados.</small></div><nav class="fee-tabs"><button class="fee-tab active" data-fee-tab="overview">Visão geral</button><button class="fee-tab" data-fee-tab="standard">Tarifas padrão</button><button class="fee-tab" data-fee-tab="groups">Grupos comerciais</button><button class="fee-tab" data-fee-tab="companies">Exceções por empresa</button><button class="fee-tab" data-fee-tab="simulator">Simulador</button></nav><div class="fee-panel active" data-fee-panel="overview"><div class="fee-stat-grid"><article class="fee-stat"><span>Regras padrão</span><strong id="feeStatRules">—</strong><small id="feeStatEnabled">Carregando</small></article><article class="fee-stat"><span>Grupos comerciais</span><strong id="feeStatGroups">—</strong><small>Condições compartilhadas</small></article><article class="fee-stat"><span>Exceções individuais</span><strong id="feeStatOverrides">—</strong><small>Condições por empresa</small></article><article class="fee-stat"><span>Plataformas</span><strong>4</strong><small>Booking · Flow · Orbit · Outros</small></article></div><div class="section fee-overview-card"><div><div class="brand">POLÍTICA COMERCIAL</div><h2>Uma política, três níveis de aplicação.</h2><p>Comece pela tarifa padrão. Depois, crie grupos comerciais para condições compartilhadas ou exceções individuais para empresas específicas.</p></div><div class="fee-levels"><div><b>01</b><span><strong>Tarifa padrão</strong><small>Referência da plataforma e operação</small></span></div><div><b>02</b><span><strong>Grupo comercial</strong><small>Condição compartilhada</small></span></div><div><b>03</b><span><strong>Exceção individual</strong><small>Condição exclusiva que prevalece</small></span></div></div></div><div class="fee-note"><b>i</b><p><strong>Importante:</strong> habilitar uma tarifa não movimenta dinheiro. A cobrança depende da integração do produto ao fluxo financeiro.</p></div></div><div class="fee-panel" data-fee-panel="standard"><div class="section"><h2>Nova regra / editar regra</h2><p>Uma regra por produto e operação. Regras novas começam desativadas.</p><form id="feeForm"><label>Produto</label><select name="productCode" required><option value="booking">Zailom Booking</option><option value="flow">Zailom Flow</option><option value="orbit">Zailom Orbit</option><option value="other">Outros</option></select><label>Tipo da operação</label><input name="eventType" placeholder="Ex.: booking_payment" maxlength="80" required><label>Modelo da tarifa</label><select name="feeType"><option value="percentage">Percentual</option><option value="fixed">Valor fixo</option><option value="hybrid">Fixo + percentual</option></select><div class="grid"><div data-fee-field="fixed"><label>Valor fixo (R$)</label><input name="fixedAmount" inputmode="decimal" value="0" placeholder="Ex.: 1,50"></div><div data-fee-field="percent"><label>Percentual (%)</label><input name="ratePercent" inputmode="decimal" value="0" placeholder="Ex.: 2,99"></div><div><label>Tarifa mínima (R$)</label><input name="minimumAmount" inputmode="decimal" placeholder="Opcional"></div><div><label>Tarifa máxima (R$)</label><input name="maximumAmount" inputmode="decimal" placeholder="Opcional"></div></div><label><input type="checkbox" name="enabled"> Ativar esta regra</label><p class="muted">Ex.: 2,99% = 299 pontos-base. Valores são armazenados em centavos.</p><button type="submit">Salvar regra</button><div class="error" id="feeFormError"></div></form></div><div class="section"><div class="section-head"><h2>Regras cadastradas</h2><span class="muted">A ativação configura a regra; a cobrança só ocorre quando o produto estiver integrado.</span></div><div class="table-wrap"><table><thead><tr><th>Produto</th><th>Operação</th><th>Modelo</th><th>Tarifa</th><th>Status</th><th>Ação</th></tr></thead><tbody id="feeRows"><tr><td colspan="6" class="empty">Carregando...</td></tr></tbody></table></div></div></div><div class="fee-panel" data-fee-panel="groups"><div class="section"><h2>Grupos comerciais</h2><p class="muted">Crie condições para conjuntos de empresas. Uma empresa só pode estar em um grupo ativo por plataforma.</p>
<form id="feeGroupForm"><div class="grid"><div><label>Plataforma</label><select name="productCode"><option value="booking">Booking</option><option value="flow">Flow</option><option value="orbit">Orbit</option><option value="other">Outros</option></select></div><div><label>Nome do grupo</label><input name="name" required placeholder="Ex.: Parceiros"></div></div><label>Descrição (opcional)</label><input name="description" placeholder="Condição comercial do grupo"><button type="submit">Criar grupo</button><div class="error" id="feeGroupError"></div></form>
<div class="grid" style="margin-top:18px"><div><label>Grupo</label><select id="feeGroupSelect"></select></div><div><label>Empresas do grupo</label><select id="feeGroupMembers" multiple size="5" style="min-height:130px"></select></div></div><button class="secondary" id="feeSaveMembers" type="button">Salvar empresas selecionadas</button>
<form id="feeGroupRuleForm" style="margin-top:20px"><h3>Tarifa do grupo</h3><div class="grid"><div><label>Operação</label><input name="eventType" required placeholder="booking_payment"></div><div><label>Modelo</label><select name="feeType"><option value="percentage">Percentual</option><option value="fixed">Fixo</option><option value="hybrid">Fixo + percentual</option></select></div><div data-fee-field="fixed"><label>Valor fixo (R$)</label><input name="fixedAmount" value="0" inputmode="decimal"></div><div data-fee-field="percent"><label>Percentual (%)</label><input name="ratePercent" value="0" inputmode="decimal"></div></div><label><input type="checkbox" name="enabled"> Ativar tarifa do grupo</label><button type="submit">Salvar tarifa do grupo</button><div class="error" id="feeGroupRuleError"></div></form>
<div class="table-wrap"><table><thead><tr><th>Grupo</th><th>Plataforma</th><th>Empresas</th><th>Status</th></tr></thead><tbody id="feeGroupRows"><tr><td colspan="4" class="empty">Carregando...</td></tr></tbody></table></div></div></div><div class="fee-panel" data-fee-panel="companies"><div class="section"><h2>Condição especial por empresa</h2><p class="muted">A exceção individual prevalece sobre o grupo e a tarifa padrão.</p>
<form id="companyFeeForm"><label>Empresa</label><select name="organizationId" id="companyFeeOrg" required></select><div class="grid"><div><label>Plataforma</label><select name="productCode"><option value="booking">Booking</option><option value="flow">Flow</option><option value="orbit">Orbit</option><option value="other">Outros</option></select></div><div><label>Operação</label><input name="eventType" required placeholder="booking_payment"></div><div><label>Modelo</label><select name="feeType"><option value="percentage">Percentual</option><option value="fixed">Fixo</option><option value="hybrid">Fixo + percentual</option></select></div><div data-fee-field="fixed"><label>Valor fixo (R$)</label><input name="fixedAmount" value="0" inputmode="decimal"></div><div data-fee-field="percent"><label>Percentual (%)</label><input name="ratePercent" value="0" inputmode="decimal"></div></div><label><input type="checkbox" name="enabled"> Ativar exceção individual</label><button type="submit">Salvar condição da empresa</button><div class="error" id="companyFeeError"></div></form>
<div class="table-wrap"><table><thead><tr><th>Empresa</th><th>Plataforma</th><th>Operação</th><th>Tarifa</th><th>Status</th></tr></thead><tbody id="companyFeeRows"><tr><td colspan="5" class="empty">Carregando...</td></tr></tbody></table></div></div></div><div class="fee-panel" data-fee-panel="simulator"><div class="section"><div class="brand">PRÉVIA · SEM GRAVAÇÃO</div><h2>Simulador de tarifa</h2><p>Teste uma composição sem salvar regras ou gerar movimentações no ledger.</p><div class="fee-sim-grid"><div><label>Valor bruto (R$)</label><input id="feeSimGross" inputmode="decimal" value="100,00"></div><div><label>Modelo</label><select id="feeSimType"><option value="percentage">Percentual</option><option value="fixed">Valor fixo</option><option value="hybrid" selected>Fixo + percentual</option></select></div><div data-sim-field="fixed"><label>Valor fixo (R$)</label><input id="feeSimFixed" inputmode="decimal" value="0,50"></div><div data-sim-field="percent"><label>Percentual (%)</label><input id="feeSimRate" inputmode="decimal" value="2,99"></div></div><div class="fee-sim-result"><div><span>Tarifa estimada</span><strong id="feeSimFee">R$ 3,49</strong></div><div><span>Valor líquido estimado</span><strong id="feeSimNet">R$ 96,51</strong></div><small id="feeSimFormula">R$ 0,50 + 2,99% sobre R$ 100,00</small></div><p class="muted">Cálculo demonstrativo em centavos inteiros. Não altera regras cadastradas.</p></div></div></section></main>
<script>
function setFeeTab(n){document.querySelectorAll("[data-fee-tab]").forEach(b=>b.classList.toggle("active",b.dataset.feeTab===n));document.querySelectorAll("[data-fee-panel]").forEach(p=>p.classList.toggle("active",p.dataset.feePanel===n))}document.querySelectorAll("[data-fee-tab]").forEach(b=>b.addEventListener("click",()=>setFeeTab(b.dataset.feeTab)));function feeSimCents(v){const x=String(v??"").trim().replace(/\\s/g,"").replace(",",".");if(!/^\\d+(?:\\.\\d{0,2})?$/.test(x))throw Error("Informe um valor válido com até 2 casas decimais.");return Math.round(Number(x)*100)}function feeSimBRL(n){return(n/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}function updateFeeSimulator(){const t=document.querySelector("#feeSimType").value;document.querySelectorAll("[data-sim-field]").forEach(el=>{const off=(t==="fixed"&&el.dataset.simField==="percent")||(t==="percentage"&&el.dataset.simField==="fixed");el.style.opacity=off?".4":"1";el.querySelector("input").disabled=off});try{const gross=feeSimCents(document.querySelector("#feeSimGross").value),fixed=t==="percentage"?0:feeSimCents(document.querySelector("#feeSimFixed").value),rate=t==="fixed"?0:Number(document.querySelector("#feeSimRate").value.replace(",","."));if(!Number.isFinite(rate)||rate<0||rate>100)throw Error("Percentual deve ficar entre 0 e 100.");const fee=fixed+Math.round(gross*rate/100);if(gross<=0||fee>gross)throw Error("A tarifa deve ser menor que o valor bruto.");document.querySelector("#feeSimFee").textContent=feeSimBRL(fee);document.querySelector("#feeSimNet").textContent=feeSimBRL(gross-fee);document.querySelector("#feeSimFormula").textContent=t==="fixed"?"Tarifa fixa de "+feeSimBRL(fixed):t==="percentage"?rate.toFixed(2).replace(".",",")+"% sobre "+feeSimBRL(gross):feeSimBRL(fixed)+" + "+rate.toFixed(2).replace(".",",")+"% sobre "+feeSimBRL(gross)}catch(e){document.querySelector("#feeSimFee").textContent="—";document.querySelector("#feeSimNet").textContent="—";document.querySelector("#feeSimFormula").textContent=e.message}}["feeSimGross","feeSimType","feeSimFixed","feeSimRate"].forEach(id=>{const el=document.getElementById(id);el.addEventListener("input",updateFeeSimulator);el.addEventListener("change",updateFeeSimulator)});updateFeeSimulator();
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

const pageMap={overview:"dashboard",organizations:"organizationsPage",participants:"participantsPage",recipients:"recipientsPage",wallet:"walletPage",fees:"feesPage"};
const routeMap={overview:"/panel",organizations:"/panel/empresas",participants:"/panel/participantes",recipients:"/panel/beneficiarios",wallet:"/panel/carteira",fees:"/panel/tarifas"};
function pageFromPath(){const path=location.pathname;return path.endsWith("/empresas")?"organizations":path.endsWith("/participantes")?"participants":path.endsWith("/beneficiarios")?"recipients":path.endsWith("/carteira")?"wallet":path.endsWith("/tarifas")?"fees":"overview"}
function goPage(p,writeHistory=true){if(!pageMap[p])p="overview";Object.entries(pageMap).forEach(([k,id])=>document.getElementById(id).classList.toggle("hidden",k!==p));document.querySelectorAll(".navBtn").forEach(b=>b.classList.toggle("active",b.dataset.page===p));if(writeHistory&&location.pathname!==routeMap[p])history.pushState({page:p},"",routeMap[p]);document.title=({overview:"Visão geral",organizations:"Empresas",participants:"Participantes",recipients:"Beneficiários",wallet:"Carteira",fees:"Tarifas"}[p])+" | Zailom Pay";document.body.classList.remove("mobile-open");if(p==="organizations")loadOrgs();if(p==="participants")loadParticipants();if(p==="recipients"){loadRecipients();loadParticipantChoices()}if(p==="wallet")loadWallet();if(p==="fees"){loadFeeRules();loadFeeManagement()}}
const showLogin=show;show=function(u){showLogin(u);document.querySelector("#sidebar").classList.remove("hidden");goPage(pageFromPath(),false)};
document.querySelectorAll(".navBtn").forEach(b=>b.onclick=()=>goPage(b.dataset.page));
document.querySelector("#menuToggle").onclick=()=>document.body.classList.toggle("mobile-open");document.querySelector("#mobileShade").onclick=()=>document.body.classList.remove("mobile-open");document.querySelector("#collapseSide").onclick=()=>document.body.classList.toggle("collapsed");window.addEventListener("popstate",()=>{if(!dashboard.classList.contains("hidden"))goPage(pageFromPath(),false)});

function formatBRL(minor){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(minor||0)/100)}
async function loadWallet(){const box=document.querySelector("#walletError");box.textContent="";try{const d=await api("/api/v1/admin/wallet");document.querySelector("#walletAvailable").textContent=formatBRL(d.balances.availableMinor);document.querySelector("#walletFees").textContent=formatBRL(d.balances.feesEarnedMinor);document.querySelector("#walletClearing").textContent=formatBRL(d.balances.awaitingSettlementMinor);document.querySelector("#walletProviderFees").textContent=formatBRL(d.balances.providerFeesMinor);document.querySelector("#walletUpdated").textContent="Atualizado "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});document.querySelector("#walletRows").innerHTML=d.withdrawals.map(w=>"<tr><td>"+escapeHtml(w.id.slice(0,8))+"</td><td>"+escapeHtml(w.destination_label||"—")+"</td><td>"+formatBRL(w.amount_minor)+"</td><td>"+escapeHtml(w.status)+"</td><td>"+escapeHtml(new Date(w.requested_at).toLocaleString("pt-BR"))+"</td></tr>").join("")||'<tr><td colspan="5" class="empty">Nenhum saque registrado.</td></tr>';}catch(e){box.textContent="Não foi possível carregar a carteira: "+e.message}}
document.querySelector("#walletReload").onclick=loadWallet;


function moneyToMinor(value){let normalized=String(value??"").trim().split(" ").join("");if(normalized.includes(","))normalized=normalized.split(".").join("").replace(",",".");if(!normalized)return "0";const parts=normalized.split(".");if(parts.length>2||!parts[0]||!parts[0].split("").every(c=>c>="0"&&c<="9")||(parts[1]!==undefined&&(parts[1].length<1||parts[1].length>2||!parts[1].split("").every(c=>c>="0"&&c<="9"))))throw new Error("Use um valor monetário válido, com até 2 casas decimais.");return (BigInt(parts[0])*100n+BigInt(((parts[1]||"")+"00").slice(0,2))).toString()}
function percentToBps(value){let raw=String(value??"").trim().split(" ").join("").replace(",",".");if(raw==="")raw="0";const parts=raw.split(".");if(parts.length>2||(parts[0]!==""&&!parts[0].split("").every(c=>c>="0"&&c<="9"))||(parts[0]===""&&parts.length===1)||(parts[1]!==undefined&&(parts[1].length<1||parts[1].length>2||!parts[1].split("").every(c=>c>="0"&&c<="9"))))throw new Error("Informe um percentual válido com até 2 casas decimais.");const whole=parts[0]||"0",decimal=parts[1]||"";const bps=BigInt(whole)*100n+BigInt((decimal+"00").slice(0,2));if(bps>10000n)throw new Error("O percentual deve estar entre 0 e 100%.");return Number(bps)}
function syncFeeFields(form){const type=form.elements.feeType.value;const fixed=form.querySelector('[data-fee-field="fixed"]'),percent=form.querySelector('[data-fee-field="percent"]');if(fixed){const disabled=type==="percentage";fixed.querySelector("input").disabled=disabled;fixed.style.opacity=disabled?".4":"1"}if(percent){const disabled=type==="fixed";percent.querySelector("input").disabled=disabled;percent.style.opacity=disabled?".4":"1"}}
function setupFeeForm(form){const select=form.elements.feeType;select.addEventListener("change",()=>syncFeeFields(form));syncFeeFields(form)}
function minorToMoney(value){const n=BigInt(value||"0");return "R$ "+(n/100n).toString()+","+(n%100n).toString().padStart(2,"0")}
function feeLabel(r){if(r.fee_type==="fixed")return minorToMoney(r.fixed_amount_minor);if(r.fee_type==="percentage")return (r.rate_bps/100).toFixed(2).replace(".",",")+"%";return minorToMoney(r.fixed_amount_minor)+" + "+(r.rate_bps/100).toFixed(2).replace(".",",")+"%"}
async function loadFeeRules(){const body=document.querySelector("#feeRows");try{const d=await api("/api/v1/admin/fee-rules");body.innerHTML=d.rules.map(r=>"<tr><td>"+escapeHtml(r.product_code)+"</td><td>"+escapeHtml(r.event_type)+"</td><td>"+escapeHtml(r.fee_type)+"</td><td>"+escapeHtml(feeLabel(r))+"</td><td>"+(r.enabled?'<span class="pill">Ativa</span>':'<span class="muted">Desativada</span>')+"</td><td><button class='secondary' data-fee-edit='"+r.id+"'>Editar</button></td></tr>").join("")||'<tr><td colspan="6" class="empty">Nenhuma tarifa configurada.</td></tr>';document.querySelectorAll("[data-fee-edit]").forEach(b=>b.onclick=()=>{const r=d.rules.find(x=>x.id===b.dataset.feeEdit),f=document.querySelector("#feeForm");f.elements.productCode.value=r.product_code;f.elements.eventType.value=r.event_type;f.elements.feeType.value=r.fee_type;f.elements.fixedAmount.value=(Number(r.fixed_amount_minor||0)/100).toFixed(2).replace(".",",");f.elements.ratePercent.value=(r.rate_bps/100).toFixed(2).replace(".",",");f.elements.minimumAmount.value=r.minimum_amount_minor==null?"":(Number(r.minimum_amount_minor)/100).toFixed(2).replace(".",",");f.elements.maximumAmount.value=r.maximum_amount_minor==null?"":(Number(r.maximum_amount_minor)/100).toFixed(2).replace(".",",");f.elements.enabled.checked=r.enabled;syncFeeFields(f);f.scrollIntoView({behavior:"smooth",block:"start"})})}catch(e){body.innerHTML='<tr><td colspan="6" class="empty">'+escapeHtml(e.message)+'</td></tr>'}}
document.querySelector("#feeReload").onclick=loadFeeRules;
setupFeeForm(document.querySelector("#feeForm"));setupFeeForm(document.querySelector("#feeGroupRuleForm"));setupFeeForm(document.querySelector("#companyFeeForm"));
document.querySelector("#feeForm").onsubmit=async e=>{e.preventDefault();const f=e.target,err=document.querySelector("#feeFormError");err.textContent="";try{const feeType=f.elements.feeType.value;const fixed=feeType==="percentage"?"0":moneyToMinor(f.elements.fixedAmount.value);const rateBps=feeType==="fixed"?0:percentToBps(f.elements.ratePercent.value);const minimum=f.elements.minimumAmount.value?moneyToMinor(f.elements.minimumAmount.value):null,maximum=f.elements.maximumAmount.value?moneyToMinor(f.elements.maximumAmount.value):null;await api("/api/v1/admin/fee-rules",{method:"POST",body:JSON.stringify({productCode:f.elements.productCode.value,eventType:f.elements.eventType.value,feeType,fixedAmountMinor:fixed,rateBps,minimumAmountMinor:minimum,maximumAmountMinor:maximum,enabled:f.elements.enabled.checked})});await loadFeeRules();alert("Regra de tarifa salva.")}catch(x){err.textContent=x.message}};


async function loadFeeManagement(){
 const [data,orgData]=await Promise.all([api("/api/v1/admin/fee-management"),api("/api/v1/admin/organizations")]);
 const groups=data.groups, orgs=orgData.organizations||[];
 const groupSelect=document.querySelector("#feeGroupSelect");
 groupSelect.innerHTML=groups.map(g=>"<option value='"+g.id+"'>"+escapeHtml(g.name)+" · "+escapeHtml(g.product_code)+"</option>").join("")||'<option value="">Crie um grupo primeiro</option>';
 document.querySelector("#feeGroupRows").innerHTML=groups.map(g=>"<tr><td>"+escapeHtml(g.name)+"</td><td>"+escapeHtml(g.product_code)+"</td><td>"+g.member_count+"</td><td>"+(g.active?"Ativo":"Inativo")+"</td></tr>").join("")||'<tr><td colspan="4" class="empty">Nenhum grupo cadastrado.</td></tr>';
 const orgOptions=orgs.filter(o=>o.status==="active").map(o=>"<option value='"+o.id+"'>"+escapeHtml(o.trade_name||o.legal_name||o.id)+"</option>").join("");
 document.querySelector("#companyFeeOrg").innerHTML='<option value="">Selecione uma empresa</option>'+orgOptions;
 function syncMembers(){const g=groups.find(x=>x.id===groupSelect.value);document.querySelector("#feeGroupMembers").innerHTML=orgOptions;const selected=new Set(g?.organization_ids||[]);document.querySelectorAll("#feeGroupMembers option").forEach(o=>o.selected=selected.has(o.value))}
 groupSelect.onchange=syncMembers;syncMembers();
 document.querySelector("#companyFeeRows").innerHTML=data.companyOverrides.map(r=>"<tr><td>"+escapeHtml(r.trade_name||r.legal_name)+"</td><td>"+escapeHtml(r.product_code)+"</td><td>"+escapeHtml(r.event_type)+"</td><td>"+escapeHtml(feeLabel(r))+"</td><td>"+(r.enabled?"Ativa":"Desativada")+"</td></tr>").join("")||'<tr><td colspan="5" class="empty">Nenhuma exceção individual cadastrada.</td></tr>';
}
document.querySelector("#feeGroupForm").onsubmit=async e=>{e.preventDefault();const f=e.target,err=document.querySelector("#feeGroupError");err.textContent="";try{await api("/api/v1/admin/fee-groups",{method:"POST",body:JSON.stringify({productCode:f.elements.productCode.value,name:f.elements.name.value,description:f.elements.description.value})});f.reset();await loadFeeManagement()}catch(x){err.textContent=x.message}};
document.querySelector("#feeSaveMembers").onclick=async()=>{const err=document.querySelector("#feeGroupError");err.textContent="";try{const groupId=document.querySelector("#feeGroupSelect").value;if(!groupId)throw new Error("Crie ou selecione um grupo.");const organizationIds=Array.from(document.querySelector("#feeGroupMembers").selectedOptions).map(o=>o.value);await api("/api/v1/admin/fee-groups/"+groupId+"/members",{method:"PUT",body:JSON.stringify({organizationIds})});await loadFeeManagement()}catch(x){err.textContent=x.message}};
function feeFormPayload(f){const feeType=f.elements.feeType.value;return {eventType:f.elements.eventType.value,feeType,fixedAmountMinor:feeType==="percentage"?"0":moneyToMinor(f.elements.fixedAmount.value),rateBps:feeType==="fixed"?0:percentToBps(f.elements.ratePercent.value),enabled:f.elements.enabled.checked}}
document.querySelector("#feeGroupRuleForm").onsubmit=async e=>{e.preventDefault();const f=e.target,err=document.querySelector("#feeGroupRuleError");err.textContent="";try{const id=document.querySelector("#feeGroupSelect").value;if(!id)throw new Error("Crie ou selecione um grupo.");await api("/api/v1/admin/fee-groups/"+id+"/rules",{method:"POST",body:JSON.stringify(feeFormPayload(f))});alert("Tarifa do grupo salva.")}catch(x){err.textContent=x.message}};
document.querySelector("#companyFeeForm").onsubmit=async e=>{e.preventDefault();const f=e.target,err=document.querySelector("#companyFeeError");err.textContent="";try{const id=f.elements.organizationId.value;if(!id)throw new Error("Selecione uma empresa.");const payload=feeFormPayload(f);payload.productCode=f.elements.productCode.value;await api("/api/v1/admin/companies/"+id+"/fee-rules",{method:"POST",body:JSON.stringify(payload)});await loadFeeManagement();alert("Condição individual salva.")}catch(x){err.textContent=x.message}};

function formData(f){return Object.fromEntries(new FormData(f).entries())}
async function loadOrgs(){const d=await api("/api/v1/admin/organizations");document.querySelector("#orgRows").innerHTML=d.organizations.map(o=>"<tr><td>"+escapeHtml(o.trade_name||o.legal_name)+"</td><td>"+escapeHtml(o.tax_id||"—")+"</td><td>"+o.participant_count+"</td><td>"+o.status+"</td><td><button class='secondary' data-org='"+o.id+"' data-status='"+o.status+"'>"+(o.status==="active"?"Inativar":"Ativar")+"</button></td></tr>").join("")||'<tr><td colspan="5" class="empty">Nenhuma empresa cadastrada.</td></tr>';document.querySelectorAll("[data-org]").forEach(b=>b.onclick=async()=>{await api("/api/v1/admin/organizations/"+b.dataset.org,{method:"PATCH",body:JSON.stringify({status:b.dataset.status==="active"?"inactive":"active"})});loadOrgs()})}
document.querySelector("#newOrg").onclick=()=>document.querySelector("#orgForm").classList.toggle("hidden");document.querySelector("#orgReload").onclick=loadOrgs;document.querySelector("#orgForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/v1/admin/organizations",{method:"POST",body:JSON.stringify(formData(e.target))});e.target.reset();e.target.classList.add("hidden");loadOrgs()}catch(x){alert(x.message)}};
async function loadOrgChoices(){const d=await api("/api/v1/admin/organizations");document.querySelector("#orgSelect").innerHTML='<option value="">Sem vínculo</option>'+d.organizations.filter(o=>o.status==="active").map(o=>"<option value='"+o.id+"'>"+escapeHtml(o.trade_name||o.legal_name)+"</option>").join("")}
async function loadParticipants(){const d=await api("/api/v1/admin/participants");document.querySelector("#participantRows").innerHTML=d.participants.map(p=>"<tr><td>"+escapeHtml(p.display_name)+"</td><td>"+escapeHtml(p.email||"—")+"</td><td>"+escapeHtml(p.organization_name||"—")+"</td><td><select id='kyc-"+p.id+"'>"+["not_started","pending","under_review","approved","rejected","action_required","suspended"].map(v=>"<option "+(p.kyc_status===v?"selected":"")+" value='"+v+"'>"+v+"</option>").join("")+"</select></td><td>"+p.status+"</td><td><button class='secondary' data-kyc='"+p.id+"'>Salvar KYC</button></td></tr>").join("")||'<tr><td colspan="6" class="empty">Nenhum participante cadastrado.</td></tr>';document.querySelectorAll("[data-kyc]").forEach(b=>b.onclick=async()=>{await api("/api/v1/admin/participants/"+b.dataset.kyc,{method:"PATCH",body:JSON.stringify({kycStatus:document.querySelector("#kyc-"+b.dataset.kyc).value})});loadParticipants()})}
document.querySelector("#newParticipant").onclick=async()=>{await loadOrgChoices();document.querySelector("#participantForm").classList.toggle("hidden")};document.querySelector("#participantReload").onclick=loadParticipants;document.querySelector("#participantForm").onsubmit=async e=>{e.preventDefault();const d=formData(e.target);if(!d.organizationId)delete d.organizationId;if(!d.email)delete d.email;if(!d.taxId)delete d.taxId;try{await api("/api/v1/admin/participants",{method:"POST",body:JSON.stringify(d)});e.target.reset();e.target.classList.add("hidden");loadParticipants()}catch(x){alert(x.message)}};
async function loadParticipantChoices(){const d=await api("/api/v1/admin/participants");document.querySelector("#recipientSelect").innerHTML='<option value="">Selecione</option>'+d.participants.map(p=>"<option value='"+p.id+"'>"+escapeHtml(p.display_name)+"</option>").join("")}
async function loadRecipients(){const d=await api("/api/v1/admin/provider-recipients");document.querySelector("#recipientRows").innerHTML=d.recipients.map(r=>"<tr><td>"+escapeHtml(r.participant_name)+"</td><td>"+escapeHtml(r.provider_code)+"</td><td>"+escapeHtml(r.external_recipient_id||"—")+"</td><td>"+escapeHtml(r.onboarding_status)+"</td><td>"+escapeHtml(r.kyc_status)+"</td></tr>").join("")||'<tr><td colspan="5" class="empty">Nenhum beneficiário vinculado.</td></tr>'}
document.querySelector("#recipientReload").onclick=loadRecipients;document.querySelector("#recipientForm").onsubmit=async e=>{e.preventDefault();const d=formData(e.target),id=d.participantId;delete d.participantId;if(!d.externalRecipientId)delete d.externalRecipientId;try{await api("/api/v1/admin/participants/"+id+"/provider-recipient",{method:"PUT",body:JSON.stringify(d)});e.target.reset();e.target.elements.providerCode.value="z2pay";loadRecipients()}catch(x){alert(x.message)}};
</script></body></html>`;
app.get("/panel", async (_request, reply) => reply.type("text/html; charset=utf-8").send(panelHtml));
app.get("/panel/:page", async (_request, reply) => reply.type("text/html; charset=utf-8").send(panelHtml));

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
  await registerLedgerRoutes(app, pool);
  await registerEntityRoutes(app, pool);
  await registerWalletRoutes(app, pool);
  await registerFeeRoutes(app, pool);
  await registerFeeManagementRoutes(app, pool);
  await app.listen({ port, host });
} catch (error) {
  app.log.error({ err: error }, "Failed to start Zailom Pay");
  await pool.end();
  process.exit(1);
}
