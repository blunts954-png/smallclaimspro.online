import {
  getFailedJobs,
  isAuthorizedAdminRequest,
  jsonResponse,
  notifyOps,
  requeueJobById,
} from "./_lib/pipeline.js";

export default async (request) => {
  if (!isAuthorizedAdminRequest(request)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized." });
  }

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get("limit") || 25);
      const failed = await getFailedJobs(limit);
      return jsonResponse(200, { ok: true, failed });
    }

    if (request.method === "POST") {
      const body = await request.json();
      const jobId = Number(body?.jobId || 0);
      if (!jobId) {
        return jsonResponse(400, { ok: false, error: "jobId is required." });
      }
      await requeueJobById(jobId);
      await notifyOps("Admin replay requeued job", { jobId });
      return jsonResponse(200, { ok: true, requeued: jobId });
    }

    return jsonResponse(405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error.message });
  }
};
