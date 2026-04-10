import {
  enqueueJob,
  getLatestSubmissionByEmail,
  jsonResponse,
  notifyOps,
  reservePipelineEvent,
  updatePipelineEventStatus,
  verifySquareSignature,
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

    const queued = await enqueueJob(
      "paid_packet_delivery",
      {
        eventId,
        tier,
        amountCents: amount,
        buyerEmail,
        lead,
      },
      {
        jobKey: `square:${eventId}`,
        maxAttempts: 4,
      }
    );

    await updatePipelineEventStatus(eventId, "queued");
    return jsonResponse(200, {
      ok: true,
      tier,
      buyerEmail,
      queued: true,
      jobKey: queued.jobKey,
      alreadyQueued: !queued.queued,
    });
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
