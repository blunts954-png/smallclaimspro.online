import {
  callOpenAIJson,
  claimJob,
  completeJob,
  enqueueReviewItem,
  failJob,
  fetchRunnableJobs,
  fetchSlaBreaches,
  jsonResponse,
  markSlaAlerted,
  notifyOps,
  renderPdfFromHtml,
  sendResendEmail,
  withRetries,
} from "./_lib/pipeline.js";

const DEFAULT_CONFIDENCE_THRESHOLD = Number(process.env.AI_CONFIDENCE_THRESHOLD || 0.72);

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed." });
  }

  if (!isAuthorizedWorkerCall(request)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized." });
  }

  const summary = {
    processed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    reviewed: 0,
    slaAlerts: 0,
  };

  try {
    summary.slaAlerts = await runSlaAlerts();

    const jobs = await fetchRunnableJobs(Number(process.env.WORKER_BATCH_SIZE || 8));
    for (const job of jobs) {
      summary.processed += 1;
      const claimed = await claimJob(job);
      try {
        if (claimed.job_type === "free_intake_analysis") {
          const outcome = await processFreeIntake(claimed);
          if (outcome.reviewed) summary.reviewed += 1;
        } else if (claimed.job_type === "paid_packet_delivery") {
          const outcome = await processPaidPacket(claimed);
          if (outcome.reviewed) summary.reviewed += 1;
        } else {
          throw new Error(`Unsupported job_type: ${claimed.job_type}`);
        }
        await completeJob(claimed.id, { ok: true });
        summary.completed += 1;
      } catch (error) {
        const retry = await failJob(claimed, error.message);
        if (retry.canRetry) {
          summary.retried += 1;
        } else {
          summary.failed += 1;
          await notifyOps("Queue job permanently failed", {
            jobId: claimed.id,
            jobKey: claimed.job_key,
            jobType: claimed.job_type,
            error: error.message,
          });
        }
      }
    }

    return jsonResponse(200, { ok: true, summary });
  } catch (error) {
    await notifyOps("queue-worker fatal error", { error: error.message });
    return jsonResponse(500, { ok: false, error: error.message, summary });
  }
};

function isAuthorizedWorkerCall(request) {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return true;
  const header = request.headers.get("x-worker-secret") || "";
  return header === secret;
}

async function processFreeIntake(job) {
  const lead = job?.payload?.lead;
  const submissionId = job?.payload?.submissionId;
  if (!lead?.email || !lead?.description) {
    throw new Error("Invalid free_intake_analysis payload.");
  }

  const generated = await withRetries(
    () =>
      callOpenAIJson({
        systemPrompt:
          "You are a California small claims preparation assistant. Provide educational information and document support only, never legal advice.",
        userPrompt: [
          `Client: ${lead.name}`,
          `Email: ${lead.email}`,
          `Phone: ${lead.phone || "not provided"}`,
          `Jurisdiction: Kern County, California`,
          `Case description: ${lead.description}`,
        ].join("\n"),
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            confidenceScore: { type: "number", minimum: 0, maximum: 1 },
            assessment: { type: "string" },
            actionPlan: { type: "array", items: { type: "string" } },
            demandLetterDraft: { type: "string" },
            evidencePriorities: { type: "array", items: { type: "string" } },
            filingReminder: { type: "string" },
          },
          required: [
            "confidenceScore",
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

  if (Number(generated.confidenceScore) < DEFAULT_CONFIDENCE_THRESHOLD) {
    await enqueueReviewItem({
      sourceJobKey: job.job_key,
      jobType: job.job_type,
      confidenceScore: Number(generated.confidenceScore),
      reason: "LOW_CONFIDENCE_FREE_ANALYSIS",
      payload: { lead, generated, submissionId },
    });
    await notifyOps("Free analysis moved to manual review", {
      jobKey: job.job_key,
      confidenceScore: generated.confidenceScore,
      email: lead.email,
    });
    return { reviewed: true };
  }

  await withRetries(
    () =>
      sendResendEmail({
        to: lead.email,
        subject: "Your SmallClaimsPro case action plan",
        html: buildFreeEmailHtml(lead, generated),
      }),
    2
  );
  return { reviewed: false };
}

async function processPaidPacket(job) {
  const lead = job?.payload?.lead;
  const tier = job?.payload?.tier;
  const buyerEmail = job?.payload?.buyerEmail || lead?.email;
  if (!buyerEmail || !lead?.description || !tier) {
    throw new Error("Invalid paid_packet_delivery payload.");
  }

  const packet = await withRetries(
    () =>
      callOpenAIJson({
        systemPrompt:
          "You are a California small claims document-prep assistant. Output educational template language, not legal advice.",
        userPrompt: [
          tier === "court"
            ? "Generate a practical court packet for a self-represented small-claims claimant."
            : "Generate a full done-for-you prep brief with additional hearing script detail and objections prep.",
          `Client name: ${lead.name}`,
          `Client email: ${buyerEmail}`,
          `Client phone: ${lead.phone || "not provided"}`,
          `Jurisdiction: Kern County, California`,
          `Case details: ${lead.description}`,
        ].join("\n"),
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            confidenceScore: { type: "number", minimum: 0, maximum: 1 },
            summary: { type: "string" },
            demandLetter: { type: "string" },
            filingChecklist: { type: "array", items: { type: "string" } },
            hearingScript: { type: "string" },
          },
          required: [
            "confidenceScore",
            "summary",
            "demandLetter",
            "filingChecklist",
            "hearingScript",
          ],
        },
      }),
    1
  );

  if (Number(packet.confidenceScore) < DEFAULT_CONFIDENCE_THRESHOLD) {
    await enqueueReviewItem({
      sourceJobKey: job.job_key,
      jobType: job.job_type,
      confidenceScore: Number(packet.confidenceScore),
      reason: "LOW_CONFIDENCE_PAID_PACKET",
      payload: { lead, packet, tier, buyerEmail },
    });
    await notifyOps("Paid packet moved to manual review", {
      jobKey: job.job_key,
      confidenceScore: packet.confidenceScore,
      email: buyerEmail,
      tier,
    });

    await withRetries(
      () =>
        sendResendEmail({
          to: buyerEmail,
          subject: "We are finalizing your SmallClaimsPro packet",
          html: `<p>We received your order and are finalizing your packet for quality review. You will receive it shortly.</p>`,
        }),
      1
    );
    return { reviewed: true };
  }

  const html = buildPaidEmailHtml(lead, packet, tier);
  const pdfAttachment = await renderPdfFromHtml(html);
  const attachments = pdfAttachment ? [pdfAttachment] : [];

  await withRetries(
    () =>
      sendResendEmail({
        to: buyerEmail,
        subject:
          tier === "court"
            ? "Your SmallClaimsPro Court Packet"
            : "Your SmallClaimsPro Done-For-You Prep kickoff",
        html,
        attachments,
      }),
    2
  );
  return { reviewed: false };
}

async function runSlaAlerts() {
  const breaches = await fetchSlaBreaches();
  for (const job of breaches) {
    await notifyOps("SLA breach: job delayed", {
      jobId: job.id,
      jobKey: job.job_key,
      jobType: job.job_type,
      status: job.status,
      createdAt: job.created_at,
    });
    await markSlaAlerted(job.id);
  }
  return breaches.length;
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

function buildPaidEmailHtml(lead, packet, tier) {
  const checklist = packet.filingChecklist
    .map((item) => `<li style="margin:0 0 8px 0;">${escapeHtml(item)}</li>`)
    .join("");

  return `
    <div style="font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.55;color:#111;">
      <h2 style="margin:0 0 12px 0;">Your ${tier === "court" ? "Court Packet" : "Done-For-You Prep"} is ready</h2>
      <p style="margin:0 0 12px 0;">Hi ${escapeHtml(lead.name)}, thanks for your order. This is educational document support and not legal advice.</p>
      <h3 style="margin:16px 0 8px 0;">Case summary</h3>
      <p style="margin:0 0 12px 0;">${escapeHtml(packet.summary)}</p>
      <h3 style="margin:16px 0 8px 0;">Demand letter draft</h3>
      <pre style="white-space:pre-wrap;background:#f6f8fa;padding:12px;border-radius:8px;border:1px solid #ddd;">${escapeHtml(
        packet.demandLetter
      )}</pre>
      <h3 style="margin:16px 0 8px 0;">Filing checklist</h3>
      <ul style="margin:0 0 12px 20px;padding:0;">${checklist}</ul>
      <h3 style="margin:16px 0 8px 0;">Hearing script</h3>
      <pre style="white-space:pre-wrap;background:#f6f8fa;padding:12px;border-radius:8px;border:1px solid #ddd;">${escapeHtml(
        packet.hearingScript
      )}</pre>
      <p style="margin-top:16px;">Need help refining this packet? Reply to this email and we will assist.</p>
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
