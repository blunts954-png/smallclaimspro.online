/**
 * Production smoke test:
 * node smoke-test.mjs https://smallclaimspro.online [worker-secret]
 */

const baseUrl = (process.argv[2] || "http://localhost:8888").replace(/\/+$/, "");
const workerSecret = process.argv[3] || "";

async function run() {
  console.log(`Running smoke test against: ${baseUrl}`);

  const intakePayload = {
    name: "Smoke Test User",
    email: `smoketest+${Date.now()}@example.com`,
    phone: "661-555-0100",
    description:
      "Smoke test submission for production readiness validation. Please ignore.",
    consent: true,
    source: "smoke-test",
    selectedTier: "free",
    createdAt: new Date().toISOString(),
  };

  const intakeRes = await fetch(`${baseUrl}/.netlify/functions/intake-submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intakePayload),
  });
  const intakeBody = await intakeRes.text();
  console.log(`intake-submit: ${intakeRes.status}`);
  console.log(intakeBody);

  if (!intakeRes.ok) {
    process.exitCode = 1;
    return;
  }

  const workerRes = await fetch(`${baseUrl}/.netlify/functions/queue-worker`, {
    method: "POST",
    headers: workerSecret ? { "x-worker-secret": workerSecret } : {},
  });
  const workerBody = await workerRes.text();
  console.log(`queue-worker: ${workerRes.status}`);
  console.log(workerBody);

  if (!workerRes.ok) {
    process.exitCode = 1;
    return;
  }

  console.log(
    "Intake + queue-worker endpoints are live. Next manual checks: Supabase rows, email delivery, review queue behavior, and ops alerts."
  );
}

run().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exitCode = 1;
});
