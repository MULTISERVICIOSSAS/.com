import { constantTimeEqual, json, nowIso, parseCookies, randomToken, sha256Hex } from "./utils.js";

export const SESSION_COOKIE = "ms_admin_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export async function currentAdmin(request, env) {
  const token = parseCookies(request.headers.get("Cookie") || "")[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await env.DB.prepare(
    "SELECT email, role, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?"
  ).bind(tokenHash, nowIso()).first();
  return session ? { email: session.email, rol: session.role } : null;
}

export async function login(request, env) {
  if (!env.ADMIN_PASSWORD_HASH) return json({ ok: false, error: "Clave administrativa no configurada" }, 503);
  const payload = await request.json().catch(() => ({}));
  const password = String(payload.password || payload.clave || payload.frase || "").slice(0, 300);
  const candidateHash = await sha256Hex(password);
  const validPassword = Boolean(password) && constantTimeEqual(candidateHash, env.ADMIN_PASSWORD_HASH);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!validPassword) {
    const limited = await consumeRateLimit(env.DB, `login:${ip}`, 5, 15 * 60);
    if (!limited.allowed) {
      return json({ ok: false, error: "Demasiados intentos. Intenta mas tarde." }, 429, {
        "Retry-After": String(limited.retryAfter)
      });
    }
    return json({ ok: false, error: "Clave incorrecta" }, 401);
  }

  await env.DB.prepare("DELETE FROM rate_limits WHERE key = ?").bind(`login:${ip}`).run();
  const token = randomToken(36);
  const tokenHash = await sha256Hex(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const email = env.ADMIN_EMAIL || "admin@multiservicios.website";
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(createdAt),
    env.DB.prepare("INSERT INTO sessions (token_hash, email, role, created_at, expires_at) VALUES (?, ?, 'admin', ?, ?)")
      .bind(tokenHash, email, createdAt, expiresAt)
  ]);
  await audit(env, email, "login", "Inicio de sesion admin", ip);
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
  return json({ ok: true, admin: { email, rol: "admin" } }, 200, { "Set-Cookie": cookie });
}

export async function logout(request, env) {
  const token = parseCookies(request.headers.get("Cookie") || "")[SESSION_COOKIE];
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, {
    "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
  });
}

export function sameOrigin(request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      return new URL(origin).origin === requestUrl.origin;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin === requestUrl.origin;
    } catch {
      return false;
    }
  }
  return false;
}

export async function consumeRateLimit(db, key, maximum, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db.prepare("SELECT window_start, count FROM rate_limits WHERE key = ?").bind(key).first();
  if (!existing || now - existing.window_start >= windowSeconds) {
    await db.prepare(
      "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=1"
    ).bind(key, now).run();
    return { allowed: true, retryAfter: 0 };
  }
  if (existing.count >= maximum) {
    return { allowed: false, retryAfter: Math.max(1, windowSeconds - (now - existing.window_start)) };
  }
  await db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
  return { allowed: true, retryAfter: 0 };
}

export async function audit(env, email, action, description, ip = "") {
  await env.DB.prepare(
    "INSERT INTO audit_logs (user_email, accion, descripcion, fecha, ip) VALUES (?, ?, ?, ?, ?)"
  ).bind(email || "", action, String(description || "").slice(0, 500), nowIso(), String(ip || "").slice(0, 80)).run();
}
