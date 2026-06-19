/**
 * supabase_connect — Universal Supabase Connectivity Toolkit
 *
 * May 2026 — supports ALL connection methods:
 *   1. REST API (via @supabase/supabase-js) — NOT affected by IPv4/IPv6
 *   2. Session Pooler (IPv4 compatible) — aws-0-<region>.pooler.supabase.com:5432
 *   3. Direct PostgreSQL — IPv6 only (or IPv4 add-on)
 *
 * Provides automatic fallback, diagnosis, and IPv4/IPv6 compatibility detection.
 */
export default {
  name: "supabase_connect",
  description:
    "Diagnóstico de conexión para tu PROYECTO. Usa SUPABASE_* del .env. " +
    "Para otra BD, pasa credenciales explícitamente. NUNCA uses LV_SUPABASE_*.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "test",
          "get_client",
          "get_pooler_url",
          "diagnose",
        ],
        description:
          '"test": Test all available connection methods and report which work. ' +
          '"get_client": Get a configured @supabase/supabase-js client (REST API). ' +
          '"get_pooler_url": Build the correct session pooler connection URL for IPv4 access. ' +
          '"diagnose": Check all env vars, test connections, report issues and fixes.',
      },
      url: {
        type: "string",
        description:
          "(Optional) Supabase URL override. Default: process.env.SUPABASE_URL.",
      },
      key: {
        type: "string",
        description:
          "(Optional) Supabase anon key override. Default: process.env.SUPABASE_KEY.",
      },
      serviceKey: {
        type: "string",
        description:
          "(Optional) Service role key override. Default: process.env.SUPABASE_SERVICE_ROLE_KEY.",
      },
      projectRef: {
        type: "string",
        description:
          "(Optional) Project reference ID override. Default: process.env.SUPABASE_REF.",
      },
      region: {
        type: "string",
        description:
          "(Optional) AWS region override. Default: process.env.SUPABASE_REGION or 'us-east-1'.",
      },
      dbPassword: {
        type: "string",
        description:
          "(Optional) Database password override. Default: process.env.SUPABASE_DB_PASSWORD.",
      },
    },
    required: ["action"],
  },

  handler: async ({ action, url, key, serviceKey, projectRef, region, dbPassword }) => {
    switch (action) {
      case "test":
        return await handleTest(url, key, serviceKey);
      case "get_client":
        return await handleGetClient(url, key, serviceKey);
      case "get_pooler_url":
        return await handleGetPoolerUrl(projectRef, region, dbPassword);
      case "diagnose":
        return await handleDiagnose();
      default:
        return {
          success: false,
          error: `Unknown action: "${action}". Use: test, get_client, get_pooler_url, diagnose.`,
        };
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getEnv(key) {
  return process.env[key] || "";
}

function getSupabaseUrl(override) {
  return override || getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");
}

function getSupabaseKey(override) {
  return override || getEnv("SUPABASE_KEY") || getEnv("NEXT_PUBLIC_SUPABASE_KEY");
}

function getServiceRoleKey(override) {
  return override || getEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function getProjectRef(override) {
  return override || getEnv("SUPABASE_REF") || getEnv("NEXT_PUBLIC_SUPABASE_REF");
}

function getRegion(override) {
  return override || getEnv("SUPABASE_REGION") || getEnv("NEXT_PUBLIC_SUPABASE_REGION") || "us-east-1";
}

function getDbPassword(override) {
  return override || getEnv("SUPABASE_DB_PASSWORD") || getEnv("NEXT_PUBLIC_SUPABASE_DB_PASSWORD");
}

function extractRefFromUrl(supabaseUrl) {
  if (!supabaseUrl) return null;
  const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match ? match[1] : null;
}

// ─── Action Handlers ─────────────────────────────────────────────────────────

/**
 * Test all available Supabase connection methods.
 */
async function handleTest(urlOverride, keyOverride, serviceKeyOverride) {
  const results = {
    rest_api: { status: "untested", detail: null },
    pooler_pg: { status: "untested", detail: null },
    direct_pg: { status: "untested", detail: null },
  };

  // ── Test 1: REST API via @supabase/supabase-js ──────────────────────
  const supabaseUrl = getSupabaseUrl(urlOverride);
  const supabaseKey = getSupabaseKey(keyOverride);

  if (supabaseUrl && supabaseKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(supabaseUrl, supabaseKey);
      const { error } = await client.from("_dummy_test_nonexistent").select("*").limit(1);
      // A 404/401 for a non-existent table is still a successful connection
      if (error && (error.code === "PGRST116" || error.code === "404" || error.message?.includes("does not exist"))) {
        results.rest_api = { status: "ok", detail: "REST API connected (table not found — expected)" };
      } else if (error && (error.code === "42P01" || error.message?.includes("relation"))) {
        results.rest_api = { status: "ok", detail: "REST API connected (relation not found — expected)" };
      } else if (error && error.message?.includes("Invalid API key")) {
        results.rest_api = { status: "error", detail: "Invalid API key" };
      } else if (error) {
        results.rest_api = { status: "degraded", detail: error.message };
      } else {
        results.rest_api = { status: "ok", detail: "REST API connected successfully" };
      }
    } catch (err) {
      results.rest_api = { status: "error", detail: err.message };
    }
  } else {
    results.rest_api = { status: "skipped", detail: "SUPABASE_URL or SUPABASE_KEY not configured" };
  }

  // ── Test 2: Pooler PostgreSQL (IPv4 compatible) ─────────────────────
  const ref = getProjectRef();
  const pw = getDbPassword();
  let poolerUrl = null;

  if (getEnv("SUPABASE_DB_URL")) {
    poolerUrl = getEnv("SUPABASE_DB_URL");
  } else if (ref && pw) {
    poolerUrl = buildPoolerUrl(ref, getRegion(), pw);
  }

  if (poolerUrl) {
    try {
      const pg = await import("pg");
      const client = new pg.default.Client({
        connectionString: poolerUrl,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      });
      await client.connect();
      const result = await client.query("SELECT 1 AS alive");
      await client.end();
      if (result.rows[0]?.alive === 1) {
        results.pooler_pg = { status: "ok", detail: "Session pooler (IPv4) connected successfully" };
      } else {
        results.pooler_pg = { status: "error", detail: "Pooler responded but unexpected result" };
      }
    } catch (err) {
      results.pooler_pg = { status: "error", detail: err.message };
    }
  } else {
    results.pooler_pg = { status: "skipped", detail: "SUPABASE_DB_URL or SUPABASE_REF + SUPABASE_DB_PASSWORD not configured" };
  }

  // ── Test 3: Direct PostgreSQL via DATABASE_URL ──────────────────────
  const directUrl = getEnv("DATABASE_URL");

  if (directUrl) {
    try {
      const pg = await import("pg");
      const client = new pg.default.Client({
        connectionString: directUrl,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      });
      await client.connect();
      const result = await client.query("SELECT 1 AS alive");
      await client.end();
      if (result.rows[0]?.alive === 1) {
        results.direct_pg = { status: "ok", detail: "Direct PostgreSQL connected successfully" };
      } else {
        results.direct_pg = { status: "error", detail: "Direct connection responded but unexpected result" };
      }
    } catch (err) {
      // Common error for IPv4-only networks trying direct connection
      const msg = err.message || "";
      if (msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN") || msg.includes("getaddrinfo")) {
        results.direct_pg = {
          status: "error",
          detail: "DNS resolution failed — likely IPv6-only host. Use pooler (SUPABASE_DB_URL) instead.",
          hint: "Set SUPABASE_REF, SUPABASE_REGION, and SUPABASE_DB_PASSWORD for pooler access.",
        };
      } else {
        results.direct_pg = { status: "error", detail: msg };
      }
    }
  } else {
    results.direct_pg = { status: "skipped", detail: "DATABASE_URL not configured" };
  }

  // Summary
  const working = Object.values(results).filter(r => r.status === "ok").length;
  const total = Object.values(results).filter(r => r.status !== "skipped").length;

  return {
    success: true,
    summary: `${working}/${total} tested methods working`,
    results,
    recommendation: getRecommendation(results),
  };
}

/**
 * Get a configured @supabase/supabase-js client.
 */
async function handleGetClient(urlOverride, keyOverride, serviceKeyOverride) {
  const supabaseUrl = getSupabaseUrl(urlOverride);
  const supabaseKey = serviceKeyOverride ? getServiceRoleKey(serviceKeyOverride) : getSupabaseKey(keyOverride);

  if (!supabaseUrl) {
    return {
      success: false,
      error: "SUPABASE_URL is not configured. Set in .env or pass as parameter.",
      env_vars_checked: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
    };
  }

  if (!supabaseKey) {
    return {
      success: false,
      error: "No Supabase key configured. Set SUPABASE_KEY (anon) or SUPABASE_SERVICE_ROLE_KEY in .env.",
      env_vars_checked: ["SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    };
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false, // Don't persist in server/desktop context
        autoRefreshToken: false,
      },
    });

    return {
      success: true,
      client, // The agent can now use this client directly
      url: supabaseUrl,
      key_type: serviceKeyOverride ? "service_role" : "anon",
      note: "Client created. Use for REST API operations (unaffected by IPv4/IPv6).",
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to create Supabase client: ${err.message}`,
      hint: "Ensure @supabase/supabase-js is installed. Run: npm install @supabase/supabase-js",
    };
  }
}

/**
 * Build the correct session pooler connection URL for IPv4 access.
 */
async function handleGetPoolerUrl(refOverride, regionOverride, pwOverride) {
  const ref = getProjectRef(refOverride);
  const region = getRegion(regionOverride);
  const password = getDbPassword(pwOverride);

  if (!ref) {
    return {
      success: false,
      error: "Missing project reference. Set SUPABASE_REF in .env or pass projectRef parameter.",
      hint: "Find your project ref in Supabase Dashboard → Project Settings → General → Reference ID.",
      env_vars_checked: ["SUPABASE_REF", "NEXT_PUBLIC_SUPABASE_REF"],
    };
  }

  if (!password) {
    return {
      success: false,
      error: "Missing database password. Set SUPABASE_DB_PASSWORD in .env or pass dbPassword parameter.",
      hint: "Find your DB password in Supabase Dashboard → Project Settings → Database → Password.",
      env_vars_checked: ["SUPABASE_DB_PASSWORD", "NEXT_PUBLIC_SUPABASE_DB_PASSWORD"],
    };
  }

  const poolerUrl = buildPoolerUrl(ref, region, password);

  return {
    success: true,
    connection_url: poolerUrl,
    display_url: poolerUrl.replace(password, "••••••••"),
    host: `aws-0-${region}.pooler.supabase.com`,
    port: 6543,
    project_ref: ref,
    region,
    method: "Transaction Pooler (IPv4 compatible, port 6543)",
    note: "This URL is for the Supavisor transaction pooler (port 6543) — works over IPv4. Use with pg driver for short-lived queries.",
  };
}

/**
 * Diagnose Supabase connection issues and suggest fixes.
 */
async function handleDiagnose() {
  const findings = [];
  const envVars = {};

  // ── Step 1: Check env vars ─────────────────────────────────────────
  const varList = [
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_REF",
    "SUPABASE_REGION",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_DB_URL",
    "DATABASE_URL",
    "POSTGRES_URL",
    "LV_SUPABASE_URL",
    "LV_SUPABASE_KEY",
    "LV_SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_KEY",
    "NEXT_PUBLIC_SUPABASE_REF",
    "NEXT_PUBLIC_SUPABASE_REGION",
    "NEXT_PUBLIC_SUPABASE_DB_PASSWORD",
  ];

  for (const v of varList) {
    const val = process.env[v];
    if (val) {
      // Mask sensitive values for display
      const isSensitive = v.includes("KEY") || v.includes("PASSWORD") || v.includes("SECRET");
      envVars[v] = isSensitive ? `${val.substring(0, 8)}... (${val.length} chars)` : val;
    }
  }

  const hasRestVars = !!(getSupabaseUrl() && getSupabaseKey());
  const hasPoolerVars = !!(getEnv("SUPABASE_DB_URL") || (getProjectRef() && getDbPassword()));
  const hasDirectVars = !!getEnv("DATABASE_URL");
  const hasServiceKey = !!getServiceRoleKey();

  if (!hasRestVars && !hasPoolerVars && !hasDirectVars) {
    findings.push({
      severity: "error",
      message: "No Supabase credentials found at all.",
      fix: "Add at minimum SUPABASE_URL + SUPABASE_KEY in .env for REST API access.",
    });
  }

  if (hasDirectVars && !hasPoolerVars) {
    findings.push({
      severity: "warning",
      message: "DATABASE_URL is set but pooler vars are missing.",
      detail: "If you're on an IPv4-only network, direct connection (db.<project>.supabase.co) will fail.",
      fix: "Add SUPABASE_REF + SUPABASE_DB_PASSWORD to use the session pooler (IPv4 compatible).",
    });
  }

  if (!hasPoolerVars && !hasDirectVars && hasRestVars) {
    findings.push({
      severity: "info",
      message: "Only REST API is configured.",
      detail: "For pg driver access (schema exploration, raw SQL), configure pooler or direct connection.",
    });
  }

  if (getEnv("SUPABASE_URL") && !extractRefFromUrl(getEnv("SUPABASE_URL")) && !getProjectRef()) {
    findings.push({
      severity: "info",
      message: "SUPABASE_URL is set but unable to extract project ref.",
      fix: "Set SUPABASE_REF explicitly from your project dashboard.",
    });
  }

  // ── Step 2: Check package availability ──────────────────────────────
  findings.push({
    severity: "info",
    message: "Checking required npm packages...",
  });

  let hasSupabaseJs = false;
  let hasPg = false;
  let nodeVersion = process.version;

  try {
    await import("@supabase/supabase-js");
    hasSupabaseJs = true;
  } catch {
    findings.push({
      severity: "warning",
      message: "@supabase/supabase-js is not installed.",
      detail: "Required for REST API access. Without it, only direct pg connections work.",
      fix: "Run: npm install @supabase/supabase-js",
    });
  }

  try {
    await import("pg");
    hasPg = true;
  } catch {
    findings.push({
      severity: "warning",
      message: "pg (node-postgres) is not installed.",
      detail: "Required for direct PostgreSQL connections (pooler and direct).",
      fix: "Run: npm install pg",
    });
  }

  // ── Step 3: Summary ─────────────────────────────────────────────────
  const restMethod = hasRestVars ? (hasSupabaseJs ? "ready" : "needs npm install @supabase/supabase-js") : "not configured";
  const poolerMethod = hasPoolerVars ? (hasPg ? "ready" : "needs npm install pg") : "not configured";
  const directMethod = hasDirectVars ? (hasPg ? "ready" : "needs npm install pg") : "not configured";

  return {
    success: true,
    node_version: nodeVersion,
    packages: {
      "@supabase/supabase-js": hasSupabaseJs ? "installed" : "missing",
      pg: hasPg ? "installed" : "missing",
    },
    connection_methods: {
      rest_api: restMethod,
      session_pooler_ipv4: poolerMethod,
      direct_pg_ipv6: directMethod,
    },
    env_vars_found: envVars,
    findings,
    recommendation: getDiagnosisRecommendation({
      hasRestVars, hasPoolerVars, hasDirectVars,
      hasSupabaseJs, hasPg, hasServiceKey,
    }),
  };
}

// ─── Utility Functions ───────────────────────────────────────────────────────

function buildPoolerUrl(ref, region, password) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  // Port 6543 = transaction mode (verified working May 2026)
  // Port 5432 = session mode (may timeout on some projects)
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:6543/postgres?sslmode=require`;
}

function getRecommendation(results) {
  if (results.rest_api.status === "ok") {
    return "REST API is working. Use @supabase/supabase-js for most operations.";
  }
  if (results.pooler_pg.status === "ok") {
    return "Session pooler is working. Use pg driver for schema exploration and direct SQL.";
  }
  if (results.direct_pg.status === "ok") {
    return "Direct PostgreSQL is working. Note: this requires IPv6 or IPv4 add-on.";
  }
  return "No connection method succeeded. Run 'diagnose' action for detailed troubleshooting.";
}

function getDiagnosisRecommendation({ hasRestVars, hasPoolerVars, hasDirectVars, hasSupabaseJs, hasPg, hasServiceKey }) {
  if (hasRestVars && hasSupabaseJs) {
    return "✅ REST API ready. Use supabase_connect with action='get_client' to start.";
  }
  if (hasPoolerVars && hasPg) {
    return "✅ Session pooler ready. Use db_explorer to explore your database schema.";
  }
  if (hasServiceKey) {
    return "⚠️ Service role key found but no connection method fully configured. Add SUPABASE_URL + SUPABASE_KEY for REST API.";
  }
  return "❌ Not fully configured. See findings above for steps.";
}
