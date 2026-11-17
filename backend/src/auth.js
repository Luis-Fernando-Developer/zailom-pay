import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "zp_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${Buffer.from(derived).toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const derived = Buffer.from(await scrypt(password, Buffer.from(saltHex, "hex"), 64));
  const expected = Buffer.from(hashHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function readCookie(request, name) {
  const raw = request.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

function setSessionCookie(reply, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`,
  );
}

function clearSessionCookie(reply) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  );
}

export async function bootstrapAdmin(pool, log) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    log.warn("ADMIN_EMAIL/ADMIN_PASSWORD não configurados; bootstrap administrativo ignorado");
    return;
  }
  if (password.length < 14) {
    throw new Error("ADMIN_PASSWORD precisa ter pelo menos 14 caracteres");
  }

  const passwordHash = await hashPassword(password);
  const displayName = process.env.ADMIN_NAME?.trim() || "Administrador Zailom";
  const result = await pool.query(
    `insert into public.zp_auth_users (email, password_hash, display_name, role)
     values ($1, $2, $3, 'superadmin')
     on conflict (lower(email)) do nothing
     returning id`,
    [email, passwordHash, displayName],
  );
  if (result.rowCount) log.info({ email }, "Usuário superadmin inicial criado");
}

export async function getCurrentUser(pool, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length > 256) return null;

  const result = await pool.query(
    `select u.id, u.email, u.display_name, u.role
       from public.zp_auth_sessions s
       join public.zp_auth_users u on u.id = s.user_id
      where s.token_hash = $1
        and s.expires_at > now()
        and u.status = 'active'`,
    [hashToken(token)],
  );
  if (!result.rowCount) return null;

  await pool.query(
    "update public.zp_auth_sessions set last_seen_at = now() where token_hash = $1",
    [hashToken(token)],
  );
  return result.rows[0];
}

export async function registerAuthRoutes(app, pool) {
  app.post("/api/v1/auth/login", async (request, reply) => {
    const email = typeof request.body?.email === "string"
      ? request.body.email.trim().toLowerCase()
      : "";
    const password = typeof request.body?.password === "string"
      ? request.body.password
      : "";

    if (!email || !password || email.length > 254 || password.length > 1024) {
      return reply.code(400).send({ error: "Informe e-mail e senha válidos." });
    }

    const result = await pool.query(
      `select id, email, password_hash, display_name, role
         from public.zp_auth_users
        where lower(email) = $1 and status = 'active'`,
      [email],
    );
    const user = result.rows[0];
    const valid = user
      ? await verifyPassword(password, user.password_hash)
      : false;

    if (!valid) {
      await pool.query(
        `insert into public.zp_auth_audit (event_type, email, ip_address, user_agent)
         values ('login_failed', $1, $2, $3)`,
        [email, request.ip, request.headers["user-agent"] ?? null],
      );
      return reply.code(401).send({ error: "E-mail ou senha incorretos." });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await pool.query(
      `insert into public.zp_auth_sessions
         (user_id, token_hash, expires_at, ip_address, user_agent)
       values ($1, $2, $3, $4, $5)`,
      [user.id, tokenHash, expiresAt, request.ip, request.headers["user-agent"] ?? null],
    );
    await pool.query(
      "update public.zp_auth_users set last_login_at = now() where id = $1",
      [user.id],
    );
    await pool.query(
      `insert into public.zp_auth_audit (user_id, event_type, email, ip_address, user_agent)
       values ($1, 'login_succeeded', $2, $3, $4)`,
      [user.id, user.email, request.ip, request.headers["user-agent"] ?? null],
    );

    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
      },
    };
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const user = await getCurrentUser(pool, request);
    if (!user) {
      clearSessionCookie(reply);
      return reply.code(401).send({ error: "Autenticação necessária." });
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
      },
    };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = readCookie(request, SESSION_COOKIE);
    if (token && token.length <= 256) {
      await pool.query(
        "delete from public.zp_auth_sessions where token_hash = $1",
        [hashToken(token)],
      );
    }
    clearSessionCookie(reply);
    return { success: true };
  });
}
