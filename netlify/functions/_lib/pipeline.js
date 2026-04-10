import crypto from "crypto";

export function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

export function createSubmissionFingerprint(payload) {
  const base = [
    payload.name,
    payload.email,
    payload.phone,
    payload.description,
    payload.source,
    payload.createdAt,
  ].join("|");
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 24);
}

export async function withRetries(fn, retries = 2, baseDelayMs = 500) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const waitMs = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

export async function supabaseRequest(path, options = {}) {
  const baseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }

  if (options.noContentExpected) return null;
  if (response.status === 204) return null;
  return response.json();
}

export async function persistSubmission(payload) {
  await supabaseRequest("intake_submissions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: [
      {
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        description: payload.description,
        consent: payload.consent,
        source: payload.source,
        created_at: payload.createdAt,
      },
    ],
    noContentExpected: true,
  });
}

export async function reservePipelineEvent(eventId, eventType, payload = {}) {
  const table = process.env.PIPELINE_EVENTS_TABLE || "pipeline_events";
  const rows = await supabaseRequest(
    `${table}?select=id,event_id,status&event_id=eq.${encodeURIComponent(eventId)}&limit=1`
  );
  if (Array.isArray(rows) && rows.length > 0) {
    return { reserved: false, existing: rows[0] };
  }

  try {
    await supabaseRequest(table, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: [
        {
          event_id: eventId,
          event_type: eventType,
          status: "received",
          payload,
          created_at: new Date().toISOString(),
        },
      ],
      noContentExpected: true,
    });
    return { reserved: true };
  } catch (error) {
    console.warn("reservePipelineEvent failed:", error.message);
    // Fail-open to avoid dropping traffic if pipeline_events table is missing.
    return { reserved: true, failOpen: true };
  }
}

export async function updatePipelineEventStatus(eventId, status, errorMessage = "") {
  const table = process.env.PIPELINE_EVENTS_TABLE || "pipeline_events";
  try {
    await supabaseRequest(`${table}?event_id=eq.${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: {
        status,
        error_message: errorMessage || null,
        updated_at: new Date().toISOString(),
      },
      noContentExpected: true,
    });
  } catch (error) {
    console.warn("updatePipelineEventStatus failed:", error.message);
  }
}

export async function getLatestSubmissionByEmail(email) {
  const normalized = normalizeEmail(email);
  const rows = await supabaseRequest(
    `intake_submissions?select=name,email,phone,description,source,created_at&email=eq.${encodeURIComponent(
      normalized
    )}&order=created_at.desc&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function callOpenAIJson({ systemPrompt, userPrompt, schema, temperature = 0.2 }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "smallclaims_output",
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI call failed (${response.status}): ${text}`);
  }

  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content.");
  return JSON.parse(content);
}

export async function sendResendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY or RESEND_FROM_EMAIL is missing.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend failed (${response.status}): ${text}`);
  }
}

export async function notifyWebhook(eventName, payload) {
  const webhookUrl = process.env.INTAKE_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: eventName,
        submittedAt: new Date().toISOString(),
        data: payload,
      }),
    });
  } catch (error) {
    console.warn("notifyWebhook error:", error.message);
  }
}

export async function notifyOps(message, context = {}) {
  const webhookUrl = process.env.OPS_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        severity: "error",
        message,
        context,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.warn("notifyOps error:", error.message);
  }
}

export function verifySquareSignature(rawBody, signatureHeader) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
  if (!key || !notificationUrl) return false;
  if (!signatureHeader) return false;

  const computed = crypto
    .createHmac("sha1", key)
    .update(notificationUrl + rawBody)
    .digest("base64");

  const a = Buffer.from(computed);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
