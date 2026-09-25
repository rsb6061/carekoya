interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<{ success: boolean }>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  DB?: D1Database;
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

const clean = (value: unknown, max = 500) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function requireFields(data: Record<string, unknown> | null, fields: string[]) {
  if (!data) return "Invalid JSON body";
  const missing = fields.filter((field) => !clean(data[field]));
  return missing.length ? `Missing required fields: ${missing.join(", ")}` : null;
}

function emailLooksValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function rejectBot(data: Record<string, unknown> | null) {
  return !!clean(data?.website);
}

async function handleHealth(env: Env) {
  if (!env.DB) {
    return json({
      ok: false,
      service: "carejoys",
      database: "not_configured",
      timestamp: new Date().toISOString()
    }, { status: 503 });
  }

  try {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all<{ name: string }>();

    const caregiverCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM caregivers").first<{ count: number }>();
    const employerCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM employer_leads").first<{ count: number }>();
    const schoolCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM school_leads").first<{ count: number }>();

    return json({
      ok: true,
      service: "carejoys",
      database: "ready",
      tables: (tables.results || []).map((row) => row.name),
      counts: {
        caregivers: Number(caregiverCount?.count || 0),
        employers: Number(employerCount?.count || 0),
        schools: Number(schoolCount?.count || 0)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return json({
      ok: false,
      service: "carejoys",
      database: "error",
      error: error instanceof Error ? error.message : "Database check failed",
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

async function handleEmployer(request: Request, env: Env) {
  if (!env.DB) return json({ ok: false, error: "Database not configured yet" }, { status: 503 });
  const data = await readJson(request);
  if (rejectBot(data)) return json({ ok: true }, { status: 201 });

  const error = requireFields(data, ["companyName", "contactName", "email", "zip"]);
  if (error) return json({ ok: false, error }, { status: 400 });

  const email = clean(data!.email, 320).toLowerCase();
  if (!emailLooksValid(email)) return json({ ok: false, error: "Enter a valid email address" }, { status: 400 });

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO employer_leads
      (id, company_name, contact_name, email, phone, zip, roles_needed, hiring_notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')
  `).bind(
    id,
    clean(data!.companyName, 200),
    clean(data!.contactName, 200),
    email,
    clean(data!.phone, 40),
    clean(data!.zip, 20),
    clean(data!.rolesNeeded, 500),
    clean(data!.hiringNotes, 1500)
  ).run();

  return json({ ok: true, id }, { status: 201 });
}

async function handleCaregiver(request: Request, env: Env) {
  if (!env.DB) return json({ ok: false, error: "Database not configured yet" }, { status: 503 });
  const data = await readJson(request);
  if (rejectBot(data)) return json({ ok: true }, { status: 201 });

  const error = requireFields(data, ["firstName", "lastName", "email", "phone", "zip", "role"]);
  if (error) return json({ ok: false, error }, { status: 400 });

  const email = clean(data!.email, 320).toLowerCase();
  if (!emailLooksValid(email)) return json({ ok: false, error: "Enter a valid email address" }, { status: 400 });

  const id = crypto.randomUUID();
  const smsConsent = data!.smsConsent === true ? 1 : 0;

  await env.DB.prepare(`
    INSERT INTO caregivers
      (id, first_name, last_name, display_name, email, phone, zip, role, shift_preferences,
       desired_wage, transportation, source, work_status, last_confirmed_at, sms_consent, sms_consent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'organic', 'actively_looking', CURRENT_TIMESTAMP, ?, ?)
  `).bind(
    id,
    clean(data!.firstName, 120),
    clean(data!.lastName, 120),
    `${clean(data!.firstName, 120)} ${clean(data!.lastName, 120)}`.trim(),
    email,
    clean(data!.phone, 40),
    clean(data!.zip, 20),
    clean(data!.role, 80),
    clean(data!.shifts, 500),
    clean(data!.desiredWage, 80),
    clean(data!.transportation, 80),
    smsConsent,
    smsConsent ? new Date().toISOString() : null
  ).run();

  return json({ ok: true, id }, { status: 201 });
}

async function handleSchool(request: Request, env: Env) {
  if (!env.DB) return json({ ok: false, error: "Database not configured yet" }, { status: 503 });
  const data = await readJson(request);
  if (rejectBot(data)) return json({ ok: true }, { status: 201 });

  const error = requireFields(data, ["organizationName", "contactName", "email"]);
  if (error) return json({ ok: false, error }, { status: 400 });

  const email = clean(data!.email, 320).toLowerCase();
  if (!emailLooksValid(email)) return json({ ok: false, error: "Enter a valid email address" }, { status: 400 });

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO school_leads
      (id, organization_name, contact_name, email, phone, city, state, program_types, graduating_count, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
  `).bind(
    id,
    clean(data!.organizationName, 250),
    clean(data!.contactName, 200),
    email,
    clean(data!.phone, 40),
    clean(data!.city, 120),
    clean(data!.state, 80),
    clean(data!.programTypes, 500),
    clean(data!.graduatingCount, 50),
    clean(data!.notes, 1500)
  ).run();

  return json({ ok: true, id }, { status: 201 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return handleHealth(env);
    }

    if (request.method === "POST" && url.pathname === "/api/employers") {
      return handleEmployer(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/caregivers") {
      return handleCaregiver(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/schools") {
      return handleSchool(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
