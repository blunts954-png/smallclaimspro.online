import {
  fetchSlaBreaches,
  jsonResponse,
  markSlaAlerted,
  notifyOps,
} from "./_lib/pipeline.js";

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed." });
  }

  const secret = process.env.WORKER_SECRET;
  if (secret) {
    const provided = request.headers.get("x-worker-secret") || "";
    if (provided !== secret) {
      return jsonResponse(401, { ok: false, error: "Unauthorized." });
    }
  }

  try {
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
    return jsonResponse(200, { ok: true, breaches: breaches.length });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error.message });
  }
};
