const REQUIRED_ENV_VARS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed." });
  }

  const missingVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missingVars.length) {
    console.error("Missing env vars:", missingVars.join(", "));
    return jsonResponse(500, {
      ok: false,
      error: "Server is not configured. Missing environment variables.",
    });
  }

  try {
    const payload = await request.json();
    const normalized = normalizePayload(payload);
    const validationError = validatePayload(normalized);
    if (validationError) {
      return jsonResponse(400, { ok: false, error: validationError });
    }

    const insertResult = await persistSubmission(normalized);
    if (!insertResult.ok) {
      return jsonResponse(502, { ok: false, error: "Database write failed." });
    }

    await notifyWebhook(normalized);
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error("intake-submit failed:", error);
    return jsonResponse(500, { ok: false, error: "Internal server error." });
  }
};

function normalizePayload(raw) {
  return {
    name: String(raw?.name || "").trim(),
    email: String(raw?.email || "")
      .trim()
      .toLowerCase(),
    phone: normalizePhone(raw?.phone),
    description: String(raw?.description || "").trim(),
    consent: Boolean(raw?.consent),
    source: String(raw?.source || "smallclaimspro-online-v1").trim(),
    createdAt: String(raw?.createdAt || new Date().toISOString()),
  };
}

function validatePayload(payload) {
  if (!payload.name || payload.name.length < 2) {
    return "Name is required.";
  }
  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return "Valid email is required.";
  }
  if (!payload.description || payload.description.length < 20) {
    return "Case details are too short.";
  }
  if (!payload.consent) {
    return "Consent is required.";
  }
  return null;
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return `+${digits}`;
}

async function persistSubmission(payload) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/intake_submissions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify([
      {
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        description: payload.description,
        consent: payload.consent,
        source: payload.source,
        created_at: payload.createdAt,
      },
    ]),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("Supabase insert error:", response.status, body);
    return { ok: false };
  }
  return { ok: true };
}

async function notifyWebhook(payload) {
  const webhookUrl = process.env.INTAKE_WEBHOOK_URL;
  if (!webhookUrl) {
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "intake_submission",
        submittedAt: new Date().toISOString(),
        data: payload,
      }),
    });

    if (!response.ok) {
      console.warn("Webhook notify failed:", response.status);
    }
  } catch (error) {
    console.warn("Webhook notify exception:", error);
  }
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
