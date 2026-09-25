interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<{ success: boolean }>;
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

async function handleEmployer(request: Request, env: Env) {
  if (!env.DB) return json({ ok: false, error: "Database not configured yet" }, { status: 503 });
  const data = await readJson(request);
  const error = requireFields(data, ["companyName", "contactName", "email", "zip"]);
  if (error) return json({ ok: false, error }, { status: 400 });

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO employer_leads
      (id, company_name, contact_name, email, phone, zip, roles_needed, hiring_notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')
  `).bind(
    id,
    clean(data!.companyName, 200),
    clean(data!.contactName, 200),
    clean(data!.email, 320).toLowerCase(),
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
  const error = requireFields(data, ["firstName", "lastName", "email", "phone", "zip", "role"]);
  if (error) return json({ ok: false, error }, { status: 400 });

  const id = crypto.randomUUID();
  const smsConsent = data!.smsConsent === true ? 1 : 0;

  await env.DB.prepare(`
    INSERT INTO caregivers
      (id, first_name, last_name, email, phone, zip, role, shift_preferences,
       desired_wage, transportation, source, work_status, last_confirmed_at, sms_consent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'organic', 'actively_looking', CURRENT_TIMESTAMP, ?)
  `).bind(
    id,
    clean(data!.firstName, 120),
    clean(data!.lastName, 120),
    clean(data!.email, 320).toLowerCase(),
    clean(data!.phone, 40),
    clean(data!.zip, 20),
    clean(data!.role, 80),
    clean(data!.shifts, 500),
    clean(data!.desiredWage, 80),
    clean(data!.transportation, 80),
    smsConsent
  ).run();

  return json({ ok: true, id }, { status: 201 });
}

async function handleSchool(request: Request, env: Env) {
  if (!env.DB) return json({ ok: false, error: "Database not configured yet" }, { status: 503 });
  const data = await readJson(request);
  const error = requireFields(data, ["organizationName", "contactName", "email"]);
  if (error) return json({ ok: false, error }, { status: 400 });

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO school_leads
      (id, organization_name, contact_name, email, phone, city, state, program_types, graduating_count, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
  `).bind(
    id,
    clean(data!.organizationName, 250),
    clean(data!.contactName, 200),
    clean(data!.email, 320).toLowerCase(),
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
      return json({
        ok: true,
        service: "carejoys",
        database: env.DB ? "configured" : "not_configured",
        timestamp: new Date().toISOString()
      });
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
