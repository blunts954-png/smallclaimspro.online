import {
  createSubmissionFingerprint,
  enqueueJob,
  jsonResponse,
  normalizeEmail,
  normalizePhone,
  notifyOps,
  notifyWebhook,
  persistSubmission,
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

    const automation = await enqueueAutomationJob(normalized, submissionId);
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

async function enqueueAutomationJob(payload, submissionId) {
  if (process.env.AUTO_PROCESS_INTAKE !== "true") {
    return { queued: false, reason: "AUTO_PROCESS_INTAKE_DISABLED" };
  }

  if (!process.env.OPENAI_API_KEY || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return { queued: false, reason: "MISSING_AI_OR_EMAIL_CONFIG" };
  }

  try {
    const queued = await enqueueJob(
      "free_intake_analysis",
      {
        submissionId,
        lead: payload,
      },
      {
        jobKey: `free:${submissionId}`,
        maxAttempts: 3,
      }
    );
    return {
      queued: true,
      jobKey: queued.jobKey,
      alreadyQueued: !queued.queued,
      submissionId,
    };
  } catch (error) {
    console.error("enqueueAutomationJob failed:", error);
    await notifyOps("Free automation enqueue failed", {
      submissionId,
      email: payload.email,
      error: error.message,
    });
    return { queued: false, reason: "QUEUE_ENQUEUE_FAILED", error: error.message };
  }
}
