# SmallClaimsPro.online V1 Starter

Fast-launch static starter for SmallClaimsPro.online.

## What is included

- `index.html` conversion-focused landing page
- `styles.css` responsive styling
- `app.js` Supabase + payment-link config
- `prompts.md` AI system prompts for chatbot/backend automation

## 10-minute setup

1. Open `app.js`
2. Replace:
   - `REPLACE_WITH_SUPABASE_ANON_KEY`
   - `REPLACE_WITH_SQUARE_PAYMENT_LINK_29`
   - `REPLACE_WITH_SQUARE_PAYMENT_LINK_99`
   - `https://qxdoiixdsxgqxylygkxp.supabase.co`
3. Save and deploy static files (Vercel recommended)

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

## Suggested automation flow

1. Form row is inserted into Supabase `intake_submissions`
2. Use Supabase Edge Function / automation tool to process new rows
3. AI call with `prompts.md` system prompt + user data
4. Email user with:
   - summary
   - action plan
   - message drafts
   - upsell/payment CTA
5. Optional: sync leads to Google Sheet or Airtable
6. Optional: route high-intent leads to local provider SMS/email

## Compliance baseline

- Keep disclaimer visible: "Information and document support, not legal advice."
- Avoid guarantees ("you will win")
- Keep a manual review for first 20 submissions until quality is stable

## Next fast upgrades

- Add analytics (Plausible or GA4)
- Add provider CRM tagging (hot/warm/cold)
- Add paid packet auto-delivery after Square trigger

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
