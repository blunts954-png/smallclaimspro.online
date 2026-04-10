import {
  callOpenAIJson,
  createSubmissionFingerprint,
  jsonResponse,
  normalizeEmail,
  normalizePhone,
  notifyOps,
  notifyWebhook,
  persistSubmission,
  sendResendEmail,
  withRetries,
} from "./_lib/pipeline.js";

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

    await persistSubmission(normalized);
    const submissionId = createSubmissionFingerprint(normalized);

    const automation = await runFreeAutomation(normalized, submissionId);
    await notifyWebhook("intake_submission", {
      submissionId,
      ...normalized,
      automation,
    });

    return jsonResponse(200, {
      ok: true,
      submissionId,
      automation,
    });
  } catch (error) {
    console.error("intake-submit failed:", error);
    await notifyOps("intake-submit failed", { error: error.message });
    return jsonResponse(500, { ok: false, error: "Internal server error." });
  }
};

function normalizePayload(raw) {
  return {
    name: String(raw?.name || "").trim(),
    email: normalizeEmail(raw?.email),
    phone: normalizePhone(raw?.phone),
    description: String(raw?.description || "").trim(),
    consent: Boolean(raw?.consent),
    source: String(raw?.source || "smallclaimspro-online-v2").trim(),
    createdAt: String(raw?.createdAt || new Date().toISOString()),
    selectedTier: String(raw?.selectedTier || "free").trim(),
  };
}

function validatePayload(payload) {
  if (!payload.name || payload.name.length < 2) return "Name is required.";
  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return "Valid email is required.";
  }
  if (!payload.description || payload.description.length < 20) {
    return "Case details are too short.";
  }
  if (!payload.consent) return "Consent is required.";
  return null;
}

async function runFreeAutomation(payload, submissionId) {
  if (process.env.AUTO_PROCESS_INTAKE !== "true") {
    return { processed: false, reason: "AUTO_PROCESS_INTAKE_DISABLED" };
  }

  if (!process.env.OPENAI_API_KEY || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return { processed: false, reason: "MISSING_AI_OR_EMAIL_CONFIG" };
  }

  try {
    const generated = await withRetries(
      () =>
        callOpenAIJson({
          systemPrompt:
            "You are a California small claims preparation assistant. Provide educational information and document support only, never legal advice.",
          userPrompt: [
            `Client: ${payload.name}`,
            `Email: ${payload.email}`,
            `Phone: ${payload.phone || "not provided"}`,
            `Jurisdiction: Kern County, California`,
            `Case description: ${payload.description}`,
            "Return practical next steps and a short demand letter draft.",
          ].join("\n"),
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              assessment: { type: "string" },
              actionPlan: { type: "array", items: { type: "string" } },
              demandLetterDraft: { type: "string" },
              evidencePriorities: { type: "array", items: { type: "string" } },
              filingReminder: { type: "string" },
            },
            required: [
              "assessment",
              "actionPlan",
              "demandLetterDraft",
              "evidencePriorities",
              "filingReminder",
            ],
          },
        }),
      1
    );

    const html = buildFreeEmailHtml(payload, generated);
    await withRetries(
      () =>
        sendResendEmail({
          to: payload.email,
          subject: "Your SmallClaimsPro case action plan",
          html,
        }),
      2
    );

    return { processed: true, delivery: "email_sent", submissionId };
  } catch (error) {
    console.error("runFreeAutomation failed:", error);
    await notifyOps("Free automation failed", {
      submissionId,
      email: payload.email,
      error: error.message,
    });
    return { processed: false, reason: "AUTOMATION_FAILED", error: error.message };
  }
}

function buildFreeEmailHtml(payload, generated) {
  const planItems = generated.actionPlan
    .map((step) => `<li style="margin:0 0 8px 0;">${escapeHtml(step)}</li>`)
    .join("");
  const evidenceItems = generated.evidencePriorities
    .map((item) => `<li style="margin:0 0 8px 0;">${escapeHtml(item)}</li>`)
    .join("");

  return `
    <div style="font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.55;color:#111;">
      <h2 style="margin:0 0 12px 0;">Your SmallClaimsPro action plan</h2>
      <p style="margin:0 0 12px 0;">Hi ${escapeHtml(payload.name)}, here is your personalized plan. This is educational support, not legal advice.</p>
      <h3 style="margin:16px 0 8px 0;">Case assessment</h3>
      <p style="margin:0 0 12px 0;">${escapeHtml(generated.assessment)}</p>
      <h3 style="margin:16px 0 8px 0;">Action plan</h3>
      <ol style="margin:0 0 12px 20px;padding:0;">${planItems}</ol>
      <h3 style="margin:16px 0 8px 0;">Demand letter draft</h3>
      <pre style="white-space:pre-wrap;background:#f6f8fa;padding:12px;border-radius:8px;border:1px solid #ddd;">${escapeHtml(
        generated.demandLetterDraft
      )}</pre>
      <h3 style="margin:16px 0 8px 0;">Evidence priorities</h3>
      <ul style="margin:0 0 12px 20px;padding:0;">${evidenceItems}</ul>
      <h3 style="margin:16px 0 8px 0;">Kern County filing reminder</h3>
      <p style="margin:0 0 16px 0;">${escapeHtml(generated.filingReminder)}</p>
      <p style="margin:0;"><a href="https://square.link/u/Y6Wb0XPx">Court Packet ($29)</a> | <a href="https://square.link/u/vSbyYSIn">Done-For-You Prep ($99)</a></p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
