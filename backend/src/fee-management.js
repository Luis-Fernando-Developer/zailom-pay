import { getCurrentUser } from "./auth.js";

async function admin(pool, request, reply) {
  const user = await getCurrentUser(pool, request);
  if (!user) { reply.code(401).send({ error: "Autenticação necessária." }); return null; }
  if (!["superadmin", "admin"].includes(user.role)) { reply.code(403).send({ error: "Permissão insuficiente." }); return null; }
  return user;
}

const productCodes = new Set(["booking", "flow", "orbit", "other"]);
const eventPattern = /^[a-zA-Z0-9_.:-]{2,80}$/;
const minorPattern = /^(0|[1-9][0-9]{0,17})$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateRule(body) {
  const feeType = body.feeType;
  const fixed = String(body.fixedAmountMinor ?? "0");
  const rate = Number(body.rateBps ?? 0);
  const minimum = body.minimumAmountMinor == null || body.minimumAmountMinor === "" ? null : String(body.minimumAmountMinor);
  const maximum = body.maximumAmountMinor == null || body.maximumAmountMinor === "" ? null : String(body.maximumAmountMinor);
  if (!["fixed", "percentage", "hybrid"].includes(feeType)) throw new Error("Modelo de tarifa inválido.");
  if (!minorPattern.test(fixed) || (minimum !== null && !minorPattern.test(minimum)) || (maximum !== null && !minorPattern.test(maximum))) throw new Error("Valores devem ser inteiros em centavos.");
  if (!Number.isInteger(rate) || rate < 0 || rate > 10000) throw new Error("Percentual inválido.");
  if (feeType === "fixed" && BigInt(fixed) <= 0n) throw new Error("Informe uma tarifa fixa maior que zero.");
  if (feeType === "percentage" && rate <= 0) throw new Error("Informe um percentual maior que zero.");
  if (feeType === "hybrid" && (BigInt(fixed) <= 0n || rate <= 0)) throw new Error("A tarifa híbrida exige valor fixo e percentual.");
  if (minimum !== null && maximum !== null && BigInt(maximum) < BigInt(minimum)) throw new Error("O teto não pode ser menor que o piso.");
  return { feeType, fixed, rate, minimum, maximum, enabled: body.enabled === true };
}

function calculateFee(rule, gross) {
  const amount = BigInt(gross);
  const fixed = BigInt(rule.fixed_amount_minor ?? rule.fixed ?? 0);
  const rate = BigInt(rule.rate_bps ?? rule.rate ?? 0);
  let fee = rule.fee_type === "fixed" ? fixed
    : rule.fee_type === "percentage" ? (amount * rate + 5000n) / 10000n
    : fixed + (amount * rate + 5000n) / 10000n;
  const min = rule.minimum_amount_minor ?? rule.minimum;
  const max = rule.maximum_amount_minor ?? rule.maximum;
  if (min != null) fee = fee < BigInt(min) ? BigInt(min) : fee;
  if (max != null) fee = fee > BigInt(max) ? BigInt(max) : fee;
  if (fee > amount) throw new Error("A tarifa calculada ultrapassa o valor bruto da operação.");
  return fee.toString();
}

export async function registerFeeManagementRoutes(app, pool) {
  app.get("/api/v1/admin/fee-management", async (request, reply) => {
    if (!await admin(pool, request, reply)) return;
    const [groups, overrides] = await Promise.all([
      pool.query(`select g.id,g.name,g.description,g.active,p.code as product_code,
        count(m.id)::int as member_count,\n        coalesce(array_agg(m.organization_id) filter (where m.id is not null), '{}'::uuid[]) as organization_ids
        from public.zp_fee_groups g join public.zp_products p on p.id=g.product_id
        left join public.zp_fee_group_members m on m.group_id=g.id
        group by g.id,p.code order by p.code,g.name`),
      pool.query(`select c.id,c.organization_id,o.trade_name,o.legal_name,p.code as product_code,
        c.event_type,c.fee_type,c.fixed_amount_minor::text,c.rate_bps,
        c.minimum_amount_minor::text,c.maximum_amount_minor::text,c.enabled
        from public.zp_company_fee_rules c
        join public.zp_organizations o on o.id=c.organization_id
        join public.zp_products p on p.id=c.product_id
        order by o.trade_name nulls last,o.legal_name,p.code,c.event_type`)
    ]);
    return { groups: groups.rows, companyOverrides: overrides.rows };
  });

  app.post("/api/v1/admin/fee-groups", async (request, reply) => {
    const user = await admin(pool, request, reply); if (!user) return;
    const { productCode, name, description = null } = request.body ?? {};
    if (!productCodes.has(productCode) || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100)
      return reply.code(400).send({ error: "Informe produto e nome válido para o grupo." });
    const result = await pool.query(`insert into public.zp_fee_groups(product_id,name,description)
      select id,$2,$3 from public.zp_products where code=$1
      returning id,name,description,active`, [productCode,name.trim(),typeof description === "string" ? description.trim().slice(0,500) : null]);
    if (!result.rowCount) return reply.code(400).send({ error: "Produto não encontrado." });
    await pool.query("insert into public.zp_auth_audit(user_id,event_type,metadata) values($1,'fee_group_created',$2::jsonb)", [user.id,JSON.stringify({productCode,name:name.trim()})]);
    return reply.code(201).send({ group: { ...result.rows[0], product_code: productCode } });
  });

  app.put("/api/v1/admin/fee-groups/:groupId/members", async (request, reply) => {
    const user = await admin(pool, request, reply); if (!user) return;
    const { groupId } = request.params;
    const ids = request.body?.organizationIds;
    if (!uuidPattern.test(groupId) || !Array.isArray(ids) || ids.length > 1000 || ids.some(id => !uuidPattern.test(id)) || new Set(ids).size !== ids.length)
      return reply.code(400).send({ error: "Lista de empresas inválida (máximo de 1.000)."});
    const client = await pool.connect();
    try {
      await client.query("begin");
      const group = await client.query("select id from public.zp_fee_groups where id=$1 and active=true for update", [groupId]);
      if (!group.rowCount) { await client.query("rollback"); return reply.code(404).send({error:"Grupo não encontrado ou inativo."}); }
      if (ids.length) {
        const found = await client.query("select count(*)::int as total from public.zp_organizations where id=any($1::uuid[]) and status='active'", [ids]);
        if (found.rows[0].total !== ids.length) { await client.query("rollback"); return reply.code(400).send({error:"Uma ou mais empresas não existem ou estão inativas."}); }
      }
      await client.query(`delete from public.zp_fee_group_members m
        using public.zp_fee_groups old_group, public.zp_fee_groups target_group
        where m.group_id=old_group.id and target_group.id=$1
          and old_group.product_id=target_group.product_id
          and old_group.id<>target_group.id and m.organization_id=any($2::uuid[])`, [groupId,ids]);
      await client.query("delete from public.zp_fee_group_members where group_id=$1", [groupId]);
      for (const id of ids) await client.query("insert into public.zp_fee_group_members(group_id,organization_id) values($1,$2)", [groupId,id]);
      await client.query("insert into public.zp_auth_audit(user_id,event_type,metadata) values($1,'fee_group_members_updated',$2::jsonb)", [user.id,JSON.stringify({groupId,organizationIds:ids})]);
      await client.query("commit");
      return { groupId, memberCount: ids.length };
    } catch (error) {
      await client.query("rollback");
      if (error.code === "P0001" || error.code === "23505") return reply.code(409).send({error:"Uma empresa já pertence a outro grupo ativo desta plataforma."});
      throw error;
    } finally { client.release(); }
  });

  app.post("/api/v1/admin/fee-groups/:groupId/rules", async (request, reply) => {
    const user = await admin(pool, request, reply); if (!user) return;
    const { groupId } = request.params, body = request.body ?? {};
    const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "";
    if (!uuidPattern.test(groupId) || !eventPattern.test(eventType)) return reply.code(400).send({error:"Grupo ou operação inválidos."});
    let rule; try { rule = validateRule(body); } catch (e) { return reply.code(400).send({error:e.message}); }
    const result = await pool.query(`insert into public.zp_fee_group_rules
      (group_id,event_type,fee_type,fixed_amount_minor,rate_bps,minimum_amount_minor,maximum_amount_minor,enabled,updated_at)
      select id,$2,$3,$4::bigint,$5,$6::bigint,$7::bigint,$8,now()
      from public.zp_fee_groups where id=$1
      on conflict(group_id,event_type) do update set fee_type=excluded.fee_type,
      fixed_amount_minor=excluded.fixed_amount_minor,rate_bps=excluded.rate_bps,
      minimum_amount_minor=excluded.minimum_amount_minor,maximum_amount_minor=excluded.maximum_amount_minor,
      enabled=excluded.enabled,updated_at=now() returning *`,
      [groupId,eventType,rule.feeType,rule.fixed,rule.rate,rule.minimum,rule.maximum,rule.enabled]);
    if (!result.rowCount) return reply.code(404).send({error:"Grupo não encontrado."});
    await pool.query("insert into public.zp_auth_audit(user_id,event_type,metadata) values($1,'fee_group_rule_saved',$2::jsonb)", [user.id,JSON.stringify({groupId,eventType,enabled:rule.enabled})]);
    return { rule: result.rows[0] };
  });

  app.post("/api/v1/admin/companies/:organizationId/fee-rules", async (request, reply) => {
    const user = await admin(pool, request, reply); if (!user) return;
    const { organizationId } = request.params, body = request.body ?? {};
    const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "";
    if (!uuidPattern.test(organizationId) || !productCodes.has(body.productCode) || !eventPattern.test(eventType))
      return reply.code(400).send({error:"Empresa, produto ou operação inválidos."});
    let rule; try { rule = validateRule(body); } catch (e) { return reply.code(400).send({error:e.message}); }
    const result = await pool.query(`insert into public.zp_company_fee_rules
      (organization_id,product_id,event_type,fee_type,fixed_amount_minor,rate_bps,minimum_amount_minor,maximum_amount_minor,enabled,updated_at)
      select $1,p.id,$3,$4,$5::bigint,$6,$7::bigint,$8::bigint,$9,now()
      from public.zp_products p where p.code=$2
      on conflict(organization_id,product_id,event_type) do update set fee_type=excluded.fee_type,
      fixed_amount_minor=excluded.fixed_amount_minor,rate_bps=excluded.rate_bps,
      minimum_amount_minor=excluded.minimum_amount_minor,maximum_amount_minor=excluded.maximum_amount_minor,
      enabled=excluded.enabled,updated_at=now() returning *`,
      [organizationId,body.productCode,eventType,rule.feeType,rule.fixed,rule.rate,rule.minimum,rule.maximum,rule.enabled]);
    if (!result.rowCount) return reply.code(404).send({error:"Empresa ou produto não encontrado."});
    await pool.query("insert into public.zp_auth_audit(user_id,event_type,metadata) values($1,'company_fee_rule_saved',$2::jsonb)", [user.id,JSON.stringify({organizationId,productCode:body.productCode,eventType,enabled:rule.enabled})]);
    return { rule: result.rows[0] };
  });

  app.delete("/api/v1/admin/companies/:organizationId/fee-rules/:ruleId", async (request, reply) => {
    const user = await admin(pool, request, reply); if (!user) return;
    const { organizationId, ruleId } = request.params;
    if (!uuidPattern.test(organizationId) || !uuidPattern.test(ruleId)) return reply.code(400).send({error:"Identificadores inválidos."});
    const result = await pool.query("delete from public.zp_company_fee_rules where id=$1 and organization_id=$2 returning id", [ruleId,organizationId]);
    if (!result.rowCount) return reply.code(404).send({error:"Exceção não encontrada."});
    await pool.query("insert into public.zp_auth_audit(user_id,event_type,metadata) values($1,'company_fee_rule_deleted',$2::jsonb)", [user.id,JSON.stringify({organizationId,ruleId})]);
    return { deleted: true };
  });

  app.post("/api/v1/admin/fee-rules/resolve", async (request, reply) => {
    if (!await admin(pool, request, reply)) return;
    const body = request.body ?? {};
    const { productCode, eventType, organizationId } = body;
    const gross = String(body.amountMinor ?? "");
    if (!productCodes.has(productCode) || !eventPattern.test(eventType ?? "") || !uuidPattern.test(organizationId ?? "") || !minorPattern.test(gross) || BigInt(gross) <= 0n)
      return reply.code(400).send({error:"Informe produto, operação, empresa e valor bruto válidos."});
    const company = await pool.query(`select c.*, 'company' as source_type, null::text as group_name
      from public.zp_company_fee_rules c join public.zp_products p on p.id=c.product_id
      where c.organization_id=$1 and p.code=$2 and c.event_type=$3 and c.enabled=true limit 1`, [organizationId,productCode,eventType]);
    let selected = company.rows[0];
    if (!selected) {
      const group = await pool.query(`select r.*, 'group' as source_type,g.name as group_name
        from public.zp_fee_group_members m join public.zp_fee_groups g on g.id=m.group_id and g.active=true
        join public.zp_products p on p.id=g.product_id
        join public.zp_fee_group_rules r on r.group_id=g.id and r.event_type=$3 and r.enabled=true
        where m.organization_id=$1 and p.code=$2 limit 1`, [organizationId,productCode,eventType]);
      selected = group.rows[0];
    }
    if (!selected) {
      const base = await pool.query(`select r.*, 'platform' as source_type,null::text as group_name
        from public.zp_fee_rules r join public.zp_products p on p.id=r.product_id
        where p.code=$1 and r.event_type=$2 and r.enabled=true limit 1`, [productCode,eventType]);
      selected = base.rows[0];
    }
    if (!selected) return { applicable:false, feeMinor:"0", netMinor:gross, source:null, reason:"no_active_rule" };
    try {
      const feeMinor = calculateFee(selected,gross);
      return { applicable:true, feeMinor, grossMinor:gross, netMinor:(BigInt(gross)-BigInt(feeMinor)).toString(),
        source:selected.source_type, groupName:selected.group_name, feeType:selected.fee_type, rateBps:selected.rate_bps };
    } catch (e) { return reply.code(422).send({error:e.message}); }
  });
}
