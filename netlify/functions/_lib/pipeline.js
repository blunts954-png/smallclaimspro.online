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

export function nowIso() {
  return new Date().toISOString();
}

export function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
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

export async function enqueueJob(jobType, payload, options = {}) {
  const table = process.env.PIPELINE_JOBS_TABLE || "pipeline_jobs";
  const jobKey = String(
    options.jobKey || `${jobType}:${crypto.randomBytes(8).toString("hex")}`
  );
  const maxAttempts = Number(options.maxAttempts || 3);
  const runAfter = String(options.runAfter || nowIso());

  const existing = await supabaseRequest(
    `${table}?select=id,job_key,status,attempts,max_attempts&job_key=eq.${encodeURIComponent(
      jobKey
    )}&limit=1`
  );
  if (Array.isArray(existing) && existing.length > 0) {
    return { queued: false, existing: existing[0], jobKey };
  }

  await supabaseRequest(table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: [
      {
        job_key: jobKey,
        job_type: jobType,
        status: "pending",
        attempts: 0,
        max_attempts: maxAttempts,
        run_after: runAfter,
        payload,
        created_at: nowIso(),
        updated_at: nowIso(),
      },
    ],
  });

  return { queued: true, jobKey };
}

export async function fetchRunnableJobs(limit = 10) {
  const table = process.env.PIPELINE_JOBS_TABLE || "pipeline_jobs";
  const rows = await supabaseRequest(
    `${table}?select=id,job_key,job_type,status,attempts,max_attempts,payload,run_after,created_at&or=(status.eq.pending,status.eq.retry)&run_after=lte.${encodeURIComponent(
      nowIso()
    )}&order=run_after.asc&limit=${Number(limit)}`
  );
  return Array.isArray(rows) ? rows : [];
}

export async function claimJob(job) {
  const table = process.env.PIPELINE_JOBS_TABLE || "pipeline_jobs";
  const attempts = Number(job.attempts || 0) + 1;
  await supabaseRequest(`${table}?id=eq.${Number(job.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: {
      status: "processing",
      attempts,
      started_at: nowIso(),
      updated_at: nowIso(),
    },
    noContentExpected: true,
  });
  return { ...job, attempts, status: "processing" };
}

export async function completeJob(jobId, result = {}) {
  const table = process.env.PIPELINE_JOBS_TABLE || "pipeline_jobs";
  await supabaseRequest(`${table}?id=eq.${Number(jobId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: {
      status: "completed",
      result,
      last_error: null,
      completed_at: nowIso(),
      updated_at: nowIso(),
    },
    noContentExpected: true,
  });
}

export async function failJob(job, errorMessage) {
  const table = process.env.PIPELINE_JOBS_TABLE || "pipeline_jobs";
  const attempts = Number(job.attempts || 0);
  const maxAttempts = Number(job.max_attempts || 3);
  const canRetry = attempts < maxAttempts;
  const backoffMinutes = Math.min(30, 2 ** Math.max(attempts - 1, 0));
  const nextRunAfter = addMinutesIso(backoffMinutes);

  await supabaseRequest(`${table}?id=eq.${Number(job.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: {
      status: canRetry ? "retry" : "failed",
      run_after: canRetry ? nextRunAfter : nowIso(),
      last_error: errorMessage,
      updated_at: nowIso(),
    },
    noContentExpected: true,
  });

  return { canRetry, nextRunAfter };
}

export async function getFailedJobs(limit = 25) {
  const table = process.env.PIPELINE_JOBS_TABLE || "pipeline_jobs";
  const rows = await supabaseRequest(
    `${table}?select=id,job_key,job_type,status,attempts,max_attempts,last_error,created_at,updated_at&status=eq.failed&order=updated_at.desc&limit=${Number(
      limit
    )}`
  );
  return Array.isArray(rows) ? rows : [];
}

export async function requeueJobById(jobId) {
  const table = process.env.PIPELINE_JOBS_TABLE || "pipeline_jobs";
  await supabaseRequest(`${table}?id=eq.${Number(jobId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: {
      status: "pending",
      attempts: 0,
      run_after: nowIso(),
      last_error: null,
      sla_alerted_at: null,
      updated_at: nowIso(),
    },
    noContentExpected: true,
  });
}

export async function fetchSlaBreaches() {
  const table = process.env.PIPELINE_JOBS_TABLE || "pipeline_jobs";
  const thresholdMinutes = Number(process.env.JOB_SLA_MINUTES || 15);
  const cutOff = addMinutesIso(-thresholdMinutes);
  const rows = await supabaseRequest(
    `${table}?select=id,job_key,job_type,status,attempts,created_at,run_after,sla_alerted_at&or=(status.eq.pending,status.eq.retry,status.eq.processing)&created_at=lte.${encodeURIComponent(
      cutOff
    )}&sla_alerted_at=is.null&limit=25`
  );
  return Array.isArray(rows) ? rows : [];
}

export async function markSlaAlerted(jobId) {
  const table = process.env.PIPELINE_JOBS_TABLE || "pipeline_jobs";
  await supabaseRequest(`${table}?id=eq.${Number(jobId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: {
      sla_alerted_at: nowIso(),
      updated_at: nowIso(),
    },
    noContentExpected: true,
  });
}

export async function enqueueReviewItem({
  sourceJobKey,
  jobType,
  confidenceScore,
  reason,
  payload,
}) {
  const table = process.env.REVIEW_QUEUE_TABLE || "review_queue";
  const existing = await supabaseRequest(
    `${table}?select=id,source_job_key,status&source_job_key=eq.${encodeURIComponent(
      sourceJobKey
    )}&limit=1`
  );
  if (Array.isArray(existing) && existing.length > 0) {
    return { queued: false, existing: existing[0] };
  }

  await supabaseRequest(table, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: [
      {
        source_job_key: sourceJobKey,
        job_type: jobType,
        confidence_score: confidenceScore,
        reason,
        payload,
        status: "pending",
        created_at: nowIso(),
      },
    ],
    noContentExpected: true,
  });
  return { queued: true };
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

export async function sendResendEmail({ to, subject, html, attachments = [] }) {
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
      attachments,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend failed (${response.status}): ${text}`);
  }
}

export async function renderPdfFromHtml(html) {
  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
    },
    body: JSON.stringify({
      source: html,
      sandbox: false,
      use_print: false,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PDFShift failed (${response.status}): ${text}`);
  }

  const bytes = await response.arrayBuffer();
  const content = Buffer.from(bytes).toString("base64");
  return {
    filename: `smallclaimspro-packet-${Date.now()}.pdf`,
    content,
    type: "application/pdf",
  };
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

export function isAuthorizedAdminRequest(request) {
  const expected = process.env.ADMIN_REPLAY_TOKEN;
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token && token === expected;
}

export function verifySquareSignature(rawBody, signatureHeader) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
  if (!key || !notificationUrl) return false;
  if (!signatureHeader) return false;

  const computed = crypto
    .createHmac("sha256", key)
    .update(notificationUrl + rawBody)
    .digest("base64");

  const a = Buffer.from(computed);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
