import assert from "node:assert/strict";
import test from "node:test";
import { login } from "../cloudflare/src/auth.js";
import { sha256Hex } from "../cloudflare/src/utils.js";

class FakeDatabase {
  constructor(count = 5) {
    this.rateLimit = { window_start: Math.floor(Date.now() / 1000), count };
  }

  prepare(sql) {
    const database = this;
    return {
      bind(...params) {
        return {
          sql,
          params,
          async first() {
            if (sql.includes("FROM rate_limits")) return database.rateLimit;
            return null;
          },
          async run() {
            if (sql.startsWith("DELETE FROM rate_limits")) database.rateLimit = null;
            if (sql.startsWith("UPDATE rate_limits") && database.rateLimit) database.rateLimit.count += 1;
            if (sql.startsWith("INSERT INTO rate_limits")) {
              database.rateLimit = { window_start: params[1], count: 1 };
            }
            return { success: true };
          }
        };
      }
    };
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ success: true }));
  }
}

function request(password) {
  return {
    headers: {
      get(name) {
        return name === "CF-Connecting-IP" ? "203.0.113.10" : null;
      }
    },
    async json() {
      return { clave: password };
    }
  };
}

test("a valid password clears an existing login lock", async () => {
  const password = "Correct-password-2026";
  const database = new FakeDatabase(5);
  const response = await login(request(password), {
    DB: database,
    ADMIN_EMAIL: "admin@example.com",
    ADMIN_PASSWORD_HASH: await sha256Hex(password)
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(database.rateLimit, null);
  assert.match(response.headers.get("Set-Cookie"), /ms_admin_session=/);
});

test("an invalid password remains blocked after the limit", async () => {
  const database = new FakeDatabase(5);
  const response = await login(request("incorrect"), {
    DB: database,
    ADMIN_PASSWORD_HASH: await sha256Hex("Correct-password-2026")
  });
  const payload = await response.json();
  assert.equal(response.status, 429);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Demasiados intentos/);
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
});
