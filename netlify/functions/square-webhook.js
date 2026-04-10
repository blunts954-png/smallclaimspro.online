import {
  callOpenAIJson,
  getLatestSubmissionByEmail,
  jsonResponse,
  notifyOps,
  reservePipelineEvent,
  sendResendEmail,
  updatePipelineEventStatus,
  verifySquareSignature,
  withRetries,
} from "./_lib/pipeline.js";

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed." });
  }

  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-square-hmacsha256-signature");
    const verified = verifySquareSignature(rawBody, signature);
    if (!verified) {
      await notifyOps("Square webhook signature check failed", {
        hasSignature: Boolean(signature),
      });
      return jsonResponse(401, { ok: false, error: "Invalid signature." });
    }

    const event = JSON.parse(rawBody);
    const eventType = String(event?.type || "");
    const eventId = String(event?.event_id || event?.id || `square:${Date.now()}`);
    const reserve = await reservePipelineEvent(eventId, eventType, event);
    if (!reserve.reserved) {
      return jsonResponse(200, { ok: true, deduped: true });
    }

    const payment = event?.data?.object?.payment;
    if (!payment) {
      await updatePipelineEventStatus(eventId, "ignored", "No payment object.");
      return jsonResponse(200, { ok: true, ignored: true });
    }

    if (payment.status !== "COMPLETED") {
      await updatePipelineEventStatus(eventId, "ignored", `Status: ${payment.status}`);
      return jsonResponse(200, { ok: true, ignored: true });
    }

    const amount = Number(payment?.amount_money?.amount || 0);
    const tier = detectTier(amount);
    const buyerEmail = String(
      payment?.buyer_email_address || payment?.customer_details?.email_address || ""
    )
      .trim()
      .toLowerCase();

    if (!buyerEmail) {
      await updatePipelineEventStatus(eventId, "failed", "Missing buyer email.");
      await notifyOps("Square paid event missing buyer email", { eventId, amount });
      return jsonResponse(200, { ok: true, ignored: true });
    }

    if (!tier) {
      await updatePipelineEventStatus(eventId, "ignored", `Unmapped amount: ${amount}`);
      return jsonResponse(200, { ok: true, ignored: true });
    }

    const latest = await getLatestSubmissionByEmail(buyerEmail);
    const lead = latest || {
      name: payment?.customer_details?.given_name || "Customer",
      email: buyerEmail,
      phone: payment?.customer_details?.phone_number || "",
      description:
        "No matching intake submission was found. Ask customer to reply with case summary.",
      source: "square-webhook-only",
    };

    const packet = await withRetries(() => generatePaidPacket(lead, tier), 1);
    await withRetries(
      () =>
        sendResendEmail({
          to: buyerEmail,
          subject:
            tier === "court"
              ? "Your SmallClaimsPro Court Packet"
              : "Your SmallClaimsPro Done-For-You Prep kickoff",
          html: buildPaidEmailHtml(lead, packet, tier),
        }),
      2
    );

    await updatePipelineEventStatus(eventId, "completed");
    return jsonResponse(200, { ok: true, tier, buyerEmail });
  } catch (error) {
    console.error("square-webhook failed:", error);
    await notifyOps("square-webhook failed", { error: error.message });
    return jsonResponse(500, { ok: false, error: "Webhook processing failed." });
  }
};

function detectTier(amountCents) {
  if (amountCents === 2900) return "court";
  if (amountCents === 9900) return "prep";
  return null;
}

async function generatePaidPacket(lead, tier) {
  const tierPrompt =
    tier === "court"
      ? "Generate a practical court packet for a self-represented small-claims claimant."
      : "Generate a full done-for-you prep brief with additional hearing script detail and objections prep.";

  return callOpenAIJson({
    systemPrompt:
      "You are a California small claims document-prep assistant. Output educational template language, not legal advice.",
    userPrompt: [
      tierPrompt,
      `Client name: ${lead.name}`,
      `Client email: ${lead.email}`,
      `Client phone: ${lead.phone || "not provided"}`,
      `Jurisdiction: Kern County, California`,
      `Case details: ${lead.description}`,
    ].join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        demandLetter: { type: "string" },
        filingChecklist: { type: "array", items: { type: "string" } },
        hearingScript: { type: "string" },
      },
      required: ["summary", "demandLetter", "filingChecklist", "hearingScript"],
    },
  });
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
