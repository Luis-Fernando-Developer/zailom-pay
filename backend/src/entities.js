import { getCurrentUser } from "./auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARTICIPANT_TYPES = new Set(["platform", "company", "professional", "other"]);
const KYC_STATUSES = new Set(["not_started", "pending", "under_review", "approved", "rejected", "action_required", "suspended"]);
const RECORD_STATUSES = new Set(["active", "inactive", "blocked"]);
const ONBOARDING_STATUSES = new Set(["not_started", "pending", "under_review", "approved", "rejected", "action_required", "blocked"]);

async function requireAdmin(pool, request, reply) {
  const user = await getCurrentUser(pool, request);
  if (!user) {
    reply.code(401).send({ error: "Autenticação necessária." });
    return null;
  }
  if (!["superadmin", "admin"].includes(user.role)) {
    reply.code(403).send({ error: "Permissão insuficiente." });
    return null;
  }
  return user;
}

function cleanText(value, max = 160) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result ? result.slice(0, max) : null;
}

function normalizeTaxId(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 || digits.length === 14 ? digits : undefined;
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function audit(client, userId, eventType, metadata) {
  await client.query(
    `insert into public.zp_auth_audit (user_id, event_type, metadata)
     values ($1, $2, $3::jsonb)`,
    [userId, eventType, JSON.stringify(metadata)],
  );
}

export async function registerEntityRoutes(app, pool) {
  app.get("/api/v1/admin/organizations", async (request, reply) => {
    if (!await requireAdmin(pool, request, reply)) return;
    const q = cleanText(request.query?.q, 100);
    const status = request.query?.status;
    if (status && !RECORD_STATUSES.has(status)) return reply.code(400).send({ error: "Filtro de status inválido." });
    const result = await pool.query(
      `select o.id, o.legal_name, o.trade_name, o.tax_id, o.status, o.created_at, o.updated_at,
              count(p.id)::int as participant_count
         from public.zp_organizations o
         left join public.zp_participants p on p.organization_id = o.id
        where ($1::text is null or o.status = $1)
          and ($2::text is null or o.legal_name ilike '%' || $2 || '%' or o.trade_name ilike '%' || $2 || '%')
        group by o.id
        order by o.created_at desc
        limit 200`,
      [status ?? null, q],
    );
    return { organizations: result.rows };
  });

  app.post("/api/v1/admin/organizations", async (request, reply) => {
    const user = await requireAdmin(pool, request, reply);
    if (!user) return;
    const body = request.body ?? {};
    const legalName = cleanText(body.legalName, 180);
    const tradeName = cleanText(body.tradeName, 180);
    const taxId = normalizeTaxId(body.taxId);
    if (!legalName && !tradeName) return reply.code(400).send({ error: "Informe a razão social ou o nome fantasia." });
    if (taxId === undefined) return reply.code(400).send({ error: "CPF/CNPJ deve conter 11 ou 14 dígitos." });

    try {
      const result = await pool.query(
        `insert into public.zp_organizations (legal_name, trade_name, tax_id)
         values ($1, $2, $3)
         returning id, legal_name, trade_name, tax_id, status, created_at`,
        [legalName, tradeName, taxId],
      );
      await pool.query(
        `insert into public.zp_auth_audit (user_id, event_type, metadata)
         values ($1, 'organization_created', $2::jsonb)`,
        [user.id, JSON.stringify({ organizationId: result.rows[0].id })],
      );
      return reply.code(201).send({ organization: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "Já existe uma empresa cadastrada com este CPF/CNPJ." });
      throw error;
    }
  });

  app.patch("/api/v1/admin/organizations/:id", async (request, reply) => {
    const user = await requireAdmin(pool, request, reply);
    if (!user) return;
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: "ID da empresa inválido." });
    const body = request.body ?? {};
    const legalName = body.legalName === undefined ? undefined : cleanText(body.legalName, 180);
    const tradeName = body.tradeName === undefined ? undefined : cleanText(body.tradeName, 180);
    const taxId = body.taxId === undefined ? undefined : normalizeTaxId(body.taxId);
    const status = body.status;
    if (legalName === null && tradeName === null) return reply.code(400).send({ error: "A empresa precisa ter razão social ou nome fantasia." });
    if (taxId === undefined && body.taxId !== undefined) return reply.code(400).send({ error: "CPF/CNPJ deve conter 11 ou 14 dígitos." });
    if (status !== undefined && !RECORD_STATUSES.has(status)) return reply.code(400).send({ error: "Status inválido." });
    if ([legalName, tradeName, taxId, status].every(value => value === undefined)) return reply.code(400).send({ error: "Nenhum campo válido para atualizar." });
    try {
      const result = await pool.query(
        `update public.zp_organizations
            set legal_name = coalesce($2, legal_name),
                trade_name = coalesce($3, trade_name),
                tax_id = case when $4::boolean then $5 else tax_id end,
                status = coalesce($6, status),
                updated_at = now()
          where id = $1
          returning id, legal_name, trade_name, tax_id, status, updated_at`,
        [id, legalName ?? null, tradeName ?? null, body.taxId !== undefined, taxId ?? null, status ?? null],
      );
      if (!result.rowCount) return reply.code(404).send({ error: "Empresa não encontrada." });
      await pool.query(
        `insert into public.zp_auth_audit (user_id, event_type, metadata)
         values ($1, 'organization_updated', $2::jsonb)`,
        [user.id, JSON.stringify({ organizationId: id, fields: Object.keys(body) })],
      );
      return { organization: result.rows[0] };
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "Já existe uma empresa cadastrada com este CPF/CNPJ." });
      throw error;
    }
  });

  app.get("/api/v1/admin/participants", async (request, reply) => {
    if (!await requireAdmin(pool, request, reply)) return;
    const q = cleanText(request.query?.q, 100);
    const organizationId = request.query?.organizationId;
    const status = request.query?.status;
    const kycStatus = request.query?.kycStatus;
    if (organizationId && !UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId inválido." });
    if (status && !RECORD_STATUSES.has(status)) return reply.code(400).send({ error: "Filtro de status inválido." });
    if (kycStatus && !KYC_STATUSES.has(kycStatus)) return reply.code(400).send({ error: "Filtro de KYC inválido." });
    const result = await pool.query(
      `select p.id, p.organization_id, o.trade_name as organization_name,
              p.external_user_id, p.participant_type, p.display_name, p.email, p.tax_id,
              p.kyc_status, p.status, p.created_at, p.updated_at
         from public.zp_participants p
         left join public.zp_organizations o on o.id = p.organization_id
        where ($1::uuid is null or p.organization_id = $1)
          and ($2::text is null or p.status = $2)
          and ($3::text is null or p.kyc_status = $3)
          and ($4::text is null or p.display_name ilike '%' || $4 || '%' or p.email ilike '%' || $4 || '%')
        order by p.created_at desc
        limit 250`,
      [organizationId ?? null, status ?? null, kycStatus ?? null, q],
    );
    return { participants: result.rows };
  });

  app.post("/api/v1/admin/participants", async (request, reply) => {
    const user = await requireAdmin(pool, request, reply);
    if (!user) return;
    const body = request.body ?? {};
    const displayName = cleanText(body.displayName, 180);
    const email = body.email === undefined || body.email === null || body.email === "" ? null : cleanText(body.email, 254)?.toLowerCase();
    const taxId = normalizeTaxId(body.taxId);
    const organizationId = body.organizationId ?? null;
    const participantType = body.participantType;
    const externalUserId = cleanText(body.externalUserId, 180);
    if (!displayName) return reply.code(400).send({ error: "Informe o nome do participante." });
    if (!PARTICIPANT_TYPES.has(participantType)) return reply.code(400).send({ error: "Tipo de participante inválido." });
    if (email && !validEmail(email)) return reply.code(400).send({ error: "E-mail inválido." });
    if (taxId === undefined) return reply.code(400).send({ error: "CPF/CNPJ deve conter 11 ou 14 dígitos." });
    if (organizationId !== null && !UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId inválido." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (organizationId) {
        const organization = await client.query("select id from public.zp_organizations where id = $1 and status = 'active' for share", [organizationId]);
        if (!organization.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Empresa não encontrada ou inativa." });
        }
      }
      const result = await client.query(
        `insert into public.zp_participants
          (organization_id, external_user_id, participant_type, display_name, email, tax_id)
         values ($1, $2, $3, $4, $5, $6)
         returning id, organization_id, external_user_id, participant_type, display_name, email, tax_id, kyc_status, status, created_at`,
        [organizationId, externalUserId, participantType, displayName, email, taxId],
      );
      await audit(client, user.id, "participant_created", { participantId: result.rows[0].id, organizationId });
      await client.query("COMMIT");
      return reply.code(201).send({ participant: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch("/api/v1/admin/participants/:id", async (request, reply) => {
    const user = await requireAdmin(pool, request, reply);
    if (!user) return;
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: "ID do participante inválido." });
    const body = request.body ?? {};
    const displayName = body.displayName === undefined ? undefined : cleanText(body.displayName, 180);
    const email = body.email === undefined ? undefined : (body.email === null || body.email === "" ? null : cleanText(body.email, 254)?.toLowerCase());
    const taxId = body.taxId === undefined ? undefined : normalizeTaxId(body.taxId);
    const status = body.status;
    const kycStatus = body.kycStatus;
    if (displayName === null) return reply.code(400).send({ error: "Nome inválido." });
    if (email && !validEmail(email)) return reply.code(400).send({ error: "E-mail inválido." });
    if (taxId === undefined && body.taxId !== undefined) return reply.code(400).send({ error: "CPF/CNPJ deve conter 11 ou 14 dígitos." });
    if (status !== undefined && !RECORD_STATUSES.has(status)) return reply.code(400).send({ error: "Status inválido." });
    if (kycStatus !== undefined && !KYC_STATUSES.has(kycStatus)) return reply.code(400).send({ error: "Status de KYC inválido." });
    if ([displayName, email, taxId, status, kycStatus].every(value => value === undefined)) return reply.code(400).send({ error: "Nenhum campo válido para atualizar." });
    const result = await pool.query(
      `update public.zp_participants
          set display_name = coalesce($2, display_name),
              email = case when $3::boolean then $4 else email end,
              tax_id = case when $5::boolean then $6 else tax_id end,
              status = coalesce($7, status),
              kyc_status = coalesce($8, kyc_status),
              updated_at = now()
        where id = $1
        returning id, organization_id, participant_type, display_name, email, tax_id, kyc_status, status, updated_at`,
      [id, displayName ?? null, body.email !== undefined, email ?? null, body.taxId !== undefined, taxId ?? null, status ?? null, kycStatus ?? null],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Participante não encontrado." });
    await pool.query(
      `insert into public.zp_auth_audit (user_id, event_type, metadata)
       values ($1, 'participant_updated', $2::jsonb)`,
      [user.id, JSON.stringify({ participantId: id, fields: Object.keys(body) })],
    );
    return { participant: result.rows[0] };
  });

  app.get("/api/v1/admin/provider-recipients", async (request, reply) => {
    if (!await requireAdmin(pool, request, reply)) return;
    const result = await pool.query(
      `select r.id, r.participant_id, p.display_name as participant_name,
              r.provider_code, r.external_recipient_id, r.onboarding_status,
              r.kyc_status, r.last_synced_at, r.created_at, r.updated_at
         from public.zp_provider_recipients r
         join public.zp_participants p on p.id = r.participant_id
        order by r.created_at desc
        limit 250`,
    );
    return { recipients: result.rows };
  });

  app.put("/api/v1/admin/participants/:id/provider-recipient", async (request, reply) => {
    const user = await requireAdmin(pool, request, reply);
    if (!user) return;
    const { id } = request.params;
    const body = request.body ?? {};
    const providerCode = cleanText(body.providerCode, 60)?.toLowerCase();
    const externalRecipientId = cleanText(body.externalRecipientId, 180);
    const onboardingStatus = body.onboardingStatus ?? "not_started";
    const kycStatus = body.kycStatus ?? "not_started";
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: "ID do participante inválido." });
    if (!providerCode || !/^[a-z0-9_-]{2,60}$/.test(providerCode)) return reply.code(400).send({ error: "providerCode inválido." });
    if (!ONBOARDING_STATUSES.has(onboardingStatus)) return reply.code(400).send({ error: "Status de onboarding inválido." });
    if (!KYC_STATUSES.has(kycStatus)) return reply.code(400).send({ error: "Status de KYC inválido." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const participant = await client.query("select id from public.zp_participants where id = $1 for share", [id]);
      if (!participant.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Participante não encontrado." });
      }
      const result = await client.query(
        `insert into public.zp_provider_recipients
          (participant_id, provider_code, external_recipient_id, onboarding_status, kyc_status, last_synced_at)
         values ($1, $2, $3, $4, $5, case when $3::text is null then null else now() end)
         on conflict (participant_id, provider_code) do update
           set external_recipient_id = excluded.external_recipient_id,
               onboarding_status = excluded.onboarding_status,
               kyc_status = excluded.kyc_status,
               last_synced_at = excluded.last_synced_at,
               updated_at = now()
         returning id, participant_id, provider_code, external_recipient_id, onboarding_status, kyc_status, last_synced_at, updated_at`,
        [id, providerCode, externalRecipientId, onboardingStatus, kycStatus],
      );
      await audit(client, user.id, "provider_recipient_updated", { participantId: id, providerCode, recipientRecordId: result.rows[0].id });
      await client.query("COMMIT");
      return { recipient: result.rows[0] };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") return reply.code(409).send({ error: "Este identificador externo já está vinculado a outro participante neste provedor." });
      throw error;
    } finally {
      client.release();
    }
  });
}
