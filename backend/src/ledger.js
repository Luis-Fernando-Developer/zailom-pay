import { createHash } from "node:crypto";
import { getCurrentUser } from "./auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_TYPES = new Set(["asset", "liability", "equity", "revenue", "expense"]);

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

function parseAmount(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^[1-9][0-9]{0,17}$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function validateBalancedEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > 100) {
    return "A transação precisa ter entre 2 e 100 lançamentos.";
  }

  const totals = new Map();
  for (const entry of entries) {
    if (!entry || !UUID_RE.test(entry.accountId ?? "")) {
      return "Cada lançamento precisa informar um accountId válido.";
    }
    if (!["debit", "credit"].includes(entry.direction)) {
      return "A direção de cada lançamento deve ser debit ou credit.";
    }
    if (typeof entry.currency !== "string" || !/^[A-Z]{3}$/.test(entry.currency)) {
      return "Informe a moeda de cada lançamento em formato ISO de 3 letras.";
    }
    const amount = parseAmount(entry.amountMinor);
    if (amount === null) {
      return "amountMinor deve ser um inteiro positivo em centavos, sem casas decimais.";
    }
    const current = totals.get(entry.currency) ?? { debit: 0n, credit: 0n };
    current[entry.direction] += amount;
    totals.set(entry.currency, current);
  }

  for (const [currency, total] of totals) {
    if (total.debit !== total.credit) {
      return "A transação não está balanceada na moeda " + currency + ".";
    }
  }
  return null;
}

export async function registerLedgerRoutes(app, pool) {
  app.get("/api/v1/admin/ledger/accounts", async (request, reply) => {
    const user = await requireAdmin(pool, request, reply);
    if (!user) return;

    const result = await pool.query(
      `select a.id, a.account_code, a.account_name, a.account_type,
              a.currency, a.active, a.participant_id, a.product_id,
              p.code as product_code, a.created_at
         from public.zp_ledger_accounts a
         left join public.zp_products p on p.id = a.product_id
        order by a.created_at desc
        limit 250`,
    );
    return { accounts: result.rows };
  });

  app.post("/api/v1/admin/ledger/accounts", async (request, reply) => {
    const user = await requireAdmin(pool, request, reply);
    if (!user) return;

    const body = request.body ?? {};
    const accountCode = typeof body.accountCode === "string" ? body.accountCode.trim() : "";
    const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
    const accountType = body.accountType;
    const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "BRL";
    const participantId = body.participantId ?? null;
    const productCode = body.productCode ?? null;

    if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(accountCode)) {
      return reply.code(400).send({ error: "accountCode deve ter de 2 a 64 caracteres alfanuméricos." });
    }
    if (!accountName || accountName.length > 120) {
      return reply.code(400).send({ error: "Informe um accountName de até 120 caracteres." });
    }
    if (!ACCOUNT_TYPES.has(accountType)) {
      return reply.code(400).send({ error: "Tipo de conta inválido." });
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      return reply.code(400).send({ error: "Moeda inválida." });
    }
    if (participantId !== null && !UUID_RE.test(participantId)) {
      return reply.code(400).send({ error: "participantId inválido." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [accountCode + ":" + currency + ":" + (participantId ?? "") + ":" + (productCode ?? "")]);
      let productId = null;
      if (productCode !== null) {
        const product = await client.query(
          "select id from public.zp_products where code = $1 and active = true",
          [productCode],
        );
        if (!product.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Produto não encontrado ou inativo." });
        }
        productId = product.rows[0].id;
      }
      if (participantId !== null) {
        const participant = await client.query(
          "select id from public.zp_participants where id = $1 and status = 'active'",
          [participantId],
        );
        if (!participant.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Participante não encontrado ou inativo." });
        }
      }

      const existing = await client.query(
        `select id from public.zp_ledger_accounts
          where account_code = $1 and currency = $2
            and participant_id is not distinct from $3::uuid
            and product_id is not distinct from $4::uuid
          limit 1`,
        [accountCode, currency, participantId, productId],
      );
      if (existing.rowCount) {
        await client.query("COMMIT");
        return reply.code(200).send({ accountId: existing.rows[0].id, alreadyExists: true });
      }

      const created = await client.query(
        `insert into public.zp_ledger_accounts
          (participant_id, product_id, account_code, account_name, account_type, currency)
         values ($1, $2, $3, $4, $5, $6)
         returning id, account_code, account_name, account_type, currency, participant_id, product_id`,
        [participantId, productId, accountCode, accountName, accountType, currency],
      );
      await client.query("COMMIT");
      return reply.code(201).send({ account: created.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/v1/admin/ledger/transactions", async (request, reply) => {
    const user = await requireAdmin(pool, request, reply);
    if (!user) return;

    const requestedLimit = Number(request.query?.limit ?? 50);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const result = await pool.query(
      `select t.id, t.product_id, p.code as product_code, t.organization_id,
              t.event_type, t.status, t.idempotency_key, t.source_type, t.source_id,
              t.description, t.posted_at, t.created_at,
              coalesce(jsonb_agg(jsonb_build_object(
                'accountId', e.account_id,
                'direction', e.direction,
                'amountMinor', e.amount_minor::text,
                'currency', e.currency,
                'description', e.description
              )) filter (where e.id is not null), '[]'::jsonb) as entries
         from public.zp_ledger_transactions t
         join public.zp_products p on p.id = t.product_id
         left join public.zp_ledger_entries e on e.transaction_id = t.id
        group by t.id, p.code
        order by t.created_at desc
        limit $1`,
      [limit],
    );
    return { transactions: result.rows };
  });

  app.post("/api/v1/admin/ledger/transactions", async (request, reply) => {
    const user = await requireAdmin(pool, request, reply);
    if (!user) return;

    const body = request.body ?? {};
    const productCode = body.productCode;
    const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const organizationId = body.organizationId ?? null;
    const entriesError = validateBalancedEntries(body.entries);

    if (typeof productCode !== "string" || !["booking", "flow", "orbit", "other"].includes(productCode)) {
      return reply.code(400).send({ error: "productCode inválido." });
    }
    if (!/^[a-zA-Z0-9_.:-]{2,80}$/.test(eventType)) {
      return reply.code(400).send({ error: "eventType inválido." });
    }
    if (!/^[a-zA-Z0-9_.:-]{8,128}$/.test(idempotencyKey)) {
      return reply.code(400).send({ error: "idempotencyKey deve ter de 8 a 128 caracteres." });
    }
    if (organizationId !== null && !UUID_RE.test(organizationId)) {
      return reply.code(400).send({ error: "organizationId inválido." });
    }
    if (description !== null && description.length > 500) {
      return reply.code(400).send({ error: "description deve ter até 500 caracteres." });
    }
    if (entriesError) return reply.code(400).send({ error: entriesError });

    const sourceType = typeof body.sourceType === "string" ? body.sourceType.slice(0, 80) : null;
    const sourceId = typeof body.sourceId === "string" ? body.sourceId.slice(0, 160) : null;
    const normalizedEntries = body.entries.map((entry) => ({
      accountId: entry.accountId,
      direction: entry.direction,
      amountMinor: String(entry.amountMinor),
      currency: entry.currency,
      description: typeof entry.description === "string" ? entry.description.slice(0, 240) : null,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const requestHash = createHash("sha256").update(JSON.stringify({
      productCode, eventType, organizationId, sourceType, sourceId, description,
      entries: normalizedEntries,
    })).digest("hex");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `insert into public.zp_ledger_transactions
          (product_id, organization_id, event_type, idempotency_key, source_type, source_id, description, metadata)
         select p.id, $2, $3, $4, $5, $6, $7, $8::jsonb
           from public.zp_products p
          where p.code = $1 and p.active = true
         on conflict (idempotency_key) do nothing
         returning id, status, idempotency_key, product_id`,
        [
          productCode, organizationId, eventType, idempotencyKey,
          sourceType, sourceId, description,
          JSON.stringify({ request_hash: requestHash }),
        ],
      );

      if (!inserted.rowCount) {
        const existing = await client.query(
          "select id, status, idempotency_key, metadata->>'request_hash' as request_hash from public.zp_ledger_transactions where idempotency_key = $1",
          [idempotencyKey],
        );
        if (existing.rowCount) {
          await client.query("COMMIT");
          if (existing.rows[0].request_hash !== requestHash) {
            return reply.code(409).send({ error: "Esta idempotencyKey já foi utilizada com dados diferentes." });
          }
          delete existing.rows[0].request_hash;
          return { transaction: existing.rows[0], alreadyProcessed: true };
        }
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "Produto não encontrado ou inativo." });
      }

      const transaction = inserted.rows[0];
      if (organizationId !== null) {
        const organization = await client.query(
          "select id from public.zp_organizations where id = $1 and status = 'active'",
          [organizationId],
        );
        if (!organization.rowCount) throw new Error("Empresa não encontrada ou inativa.");
      }
      for (const entry of body.entries) {
        const account = await client.query(
          "select id, currency, active, product_id from public.zp_ledger_accounts where id = $1 for share",
          [entry.accountId],
        );
        if (!account.rowCount || !account.rows[0].active) {
          throw new Error("Conta contábil inexistente ou inativa: " + entry.accountId);
        }
        if (account.rows[0].product_id && account.rows[0].product_id !== transaction.product_id) {
          throw new Error("A conta contábil pertence a outro produto: " + entry.accountId);
        }
        if (account.rows[0].currency !== entry.currency) {
          throw new Error("A moeda do lançamento não corresponde à moeda da conta " + entry.accountId);
        }
        await client.query(
          `insert into public.zp_ledger_entries
            (transaction_id, account_id, direction, amount_minor, currency, description)
           values ($1, $2, $3, $4::bigint, $5, $6)`,
          [
            transaction.id,
            entry.accountId,
            entry.direction,
            String(entry.amountMinor),
            typeof entry.description === "string" ? entry.description.slice(0, 240) : null,
          ],
        );
      }

      const posted = await client.query(
        `update public.zp_ledger_transactions
            set status = 'posted'
          where id = $1
          returning id, status, idempotency_key, event_type, description, posted_at, created_at`,
        [transaction.id],
      );
      await client.query(
        `insert into public.zp_auth_audit (user_id, event_type, metadata)
         values ($1, 'ledger_transaction_posted', $2::jsonb)`,
        [user.id, JSON.stringify({ transactionId: transaction.id, idempotencyKey })],
      );
      await client.query("COMMIT");
      return reply.code(201).send({ transaction: posted.rows[0], alreadyProcessed: false });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.message?.startsWith("Conta contábil") || error.message?.startsWith("A conta contábil") || error.message?.startsWith("A moeda") || error.message?.startsWith("Empresa")) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    } finally {
      client.release();
    }
  });
}
