import { getCurrentUser } from "./auth.js";

async function requireFeeAdmin(pool, request, reply) {
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

const products = new Set(["booking","flow","orbit","other"]);
const eventPattern = /^[a-zA-Z0-9_.:-]{2,80}$/;
const minorPattern = /^(0|[1-9][0-9]{0,17})$/;

export async function registerFeeRoutes(app, pool) {
  app.get("/api/v1/admin/fee-rules", async (request, reply) => {
    if (!await requireFeeAdmin(pool, request, reply)) return;
    const result = await pool.query(`
      select r.id, p.code as product_code, r.event_type, r.fee_type,
        r.fixed_amount_minor::text, r.rate_bps,
        r.minimum_amount_minor::text, r.maximum_amount_minor::text,
        r.enabled, r.created_at, r.updated_at
      from public.zp_fee_rules r
      join public.zp_products p on p.id = r.product_id
      order by p.code, r.event_type
    `);
    return { rules: result.rows };
  });

  app.post("/api/v1/admin/fee-rules", async (request, reply) => {
    const user = await requireFeeAdmin(pool, request, reply);
    if (!user) return;
    const body = request.body ?? {};
    const productCode = body.productCode;
    const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "";
    const feeType = body.feeType;
    const fixed = String(body.fixedAmountMinor ?? "0");
    const rate = Number(body.rateBps ?? 0);
    const minimum = body.minimumAmountMinor == null || body.minimumAmountMinor === "" ? null : String(body.minimumAmountMinor);
    const maximum = body.maximumAmountMinor == null || body.maximumAmountMinor === "" ? null : String(body.maximumAmountMinor);
    const enabled = body.enabled === true;

    if (!products.has(productCode)) return reply.code(400).send({error:"Produto inválido."});
    if (!eventPattern.test(eventType)) return reply.code(400).send({error:"Informe um tipo de operação válido (2 a 80 caracteres)."});
    if (!["fixed","percentage","hybrid"].includes(feeType)) return reply.code(400).send({error:"Tipo de tarifa inválido."});
    if (!minorPattern.test(fixed) || (minimum !== null && !minorPattern.test(minimum)) || (maximum !== null && !minorPattern.test(maximum))) {
      return reply.code(400).send({error:"Valores fixos, mínimo e máximo devem ser inteiros em centavos."});
    }
    if (!Number.isInteger(rate) || rate < 0 || rate > 10000) return reply.code(400).send({error:"Percentual inválido. Use pontos-base de 0 a 10000."});
    if (feeType === "fixed" && BigInt(fixed) <= 0n) return reply.code(400).send({error:"Informe uma tarifa fixa maior que zero."});
    if (feeType === "percentage" && rate <= 0) return reply.code(400).send({error:"Informe um percentual maior que zero."});
    if (feeType === "hybrid" && (BigInt(fixed) <= 0n || rate <= 0)) return reply.code(400).send({error:"A tarifa híbrida exige valor fixo e percentual."});
    if (minimum !== null && maximum !== null && BigInt(maximum) < BigInt(minimum)) return reply.code(400).send({error:"O teto não pode ser menor que o piso."});

    const result = await pool.query(`
      insert into public.zp_fee_rules
        (product_id,event_type,fee_type,fixed_amount_minor,rate_bps,minimum_amount_minor,maximum_amount_minor,enabled,updated_at)
      select p.id,$2,$3,$4::bigint,$5,$6::bigint,$7::bigint,$8,now()
      from public.zp_products p where p.code=$1
      on conflict (product_id,event_type) do update set
        fee_type=excluded.fee_type,
        fixed_amount_minor=excluded.fixed_amount_minor,
        rate_bps=excluded.rate_bps,
        minimum_amount_minor=excluded.minimum_amount_minor,
        maximum_amount_minor=excluded.maximum_amount_minor,
        enabled=excluded.enabled,
        updated_at=now()
      returning id,event_type,fee_type,fixed_amount_minor::text,rate_bps,
        minimum_amount_minor::text,maximum_amount_minor::text,enabled,updated_at
    `,[productCode,eventType,feeType,fixed,rate,minimum,maximum,enabled]);
    await pool.query(
      "insert into public.zp_auth_audit(user_id,event_type,metadata) values($1,'fee_rule_saved',$2::jsonb)",
      [user.id,JSON.stringify({productCode,eventType,enabled,feeType})]
    );
    return reply.code(200).send({rule:{...result.rows[0],product_code:productCode}});
  });
}
