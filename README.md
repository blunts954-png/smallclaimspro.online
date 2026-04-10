# SmallClaimsPro.online Production Starter

Static site + Netlify Functions backend for intake, AI packet generation, and payment fulfillment.

## What is included

- `index.html` conversion-focused landing page
- `styles.css` responsive styling
- `netlify/functions/intake-submit.js` canonical intake endpoint
- `netlify/functions/square-webhook.js` verified Square payment webhook
- `netlify/functions/queue-worker.js` async job processor
- `netlify/functions/admin-replay.js` failed-job replay API
- `netlify/functions/sla-monitor.js` SLA breach alert endpoint
- `netlify/functions/_lib/pipeline.js` shared AI/email/ops helpers
- `PRODUCTION_SCHEMA.sql` dedupe and pipeline-event schema
- `prompts.md` AI prompt reference

## Production setup

1. Run SQL in `PRODUCTION_SCHEMA.sql` and `SUPABASE_SETUP.md`.
2. Set Netlify env vars:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (optional, defaults to `gpt-4.1-mini`)
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
   - `PDFSHIFT_API_KEY` (optional, attaches branded PDF packet)
   - `AUTO_PROCESS_INTAKE=true`
   - `SQUARE_WEBHOOK_SIGNATURE_KEY`
   - `SQUARE_WEBHOOK_NOTIFICATION_URL`
   - `WORKER_SECRET`
   - `ADMIN_REPLAY_TOKEN`
   - `AI_CONFIDENCE_THRESHOLD` (example: `0.72`)
   - `JOB_SLA_MINUTES` (example: `15`)
   - `OPS_ALERT_WEBHOOK_URL` (optional; Slack/Discord webhook)
3. Deploy to Netlify.
4. Trigger worker on interval (Netlify Scheduled Function or external cron):
   - `POST /.netlify/functions/queue-worker` with `x-worker-secret`.

## Supabase payload expected

The form sends JSON:

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "661-555-0100",
  "description": "User free-text description",
  "consent": "on",
  "source": "smallclaimspro-online-v1",
  "createdAt": "2026-04-07T00:00:00.000Z"
}
```

## Runtime flow

1. `index.html` posts intake to `/.netlify/functions/intake-submit`
2. Intake is validated + persisted in Supabase `intake_submissions`
3. If `AUTO_PROCESS_INTAKE=true`, OpenAI generates free plan and Resend sends email
4. Square sends signed webhook to `/.netlify/functions/square-webhook`
5. Intake/payment events enqueue jobs in `pipeline_jobs`
6. `queue-worker` processes jobs, gates low-confidence output to `review_queue`, and delivers via email/PDF
7. Failures + SLA delays alert via `OPS_ALERT_WEBHOOK_URL`

## Compliance baseline

- Keep disclaimer visible: "Information and document support, not legal advice."
- Avoid guarantees ("you will win")
- Keep a manual review for first 20 paid packet deliveries until quality is stable

## Next fast upgrades

- Add PDF generation worker (for branded packet attachments)
- Add lightweight admin UI for `admin-replay` endpoint
- Add scheduled `sla-monitor` pings if worker cadence is low

## Analytics events already wired

`app.js` now emits the following events:

- `landing_page_view`
- `intake_form_started`
- `intake_submit_started`
- `intake_submit_success`
- `intake_submit_error`
- `intake_submit_blocked_throttle`
- `intake_submit_blocked_honeypot`
- `intake_submit_blocked_speed`
- `intake_submit_blocked_validation`
- `intake_submit_blocked_email`
- `upsell_29_clicked`
- `upsell_99_clicked`
- `intake_edge_function_error`
- `case_quiz_started`
- `case_quiz_incomplete`
- `case_quiz_completed` (params: `case_score_band`, `case_score_raw`)
- `thank_you_page_view` (thank-you page)
- `referral_share_clicked`, `referral_share_completed`, `referral_copy_link_clicked`, `referral_copy_success`

To enable tracking, add either Plausible or GA4 script tags in `index.html`.
GA4 uses Measurement ID `G-ZYCPQEBGTN` in `index.html` and `thank-you.html`.

See `TRACTION_PLAYBOOK.md` for the 14-day launch and follow-up plan.
