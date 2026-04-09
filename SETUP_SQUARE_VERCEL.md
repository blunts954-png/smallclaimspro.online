# Square + Vercel Launch Setup (Complete Checklist)

This is the exact setup to launch your current V1.

## 1) Square Setup (Payments)

1. Log in to Square Dashboard.
2. Go to **Online Checkout**.
3. Create a payment link:
   - Name: `Complete Court Packet`
   - Price: `$29`
   - Quantity: fixed 1
4. Create a second payment link:
   - Name: `Done-For-You Document Prep`
   - Price: `$99`
   - Quantity: fixed 1
5. Turn on fields for both links:
   - Buyer name
   - Buyer email
6. Publish and copy both payment URLs.
7. Paste both into `app.js`:
   - `squarePaymentLink29: "https://square.link/..."`
   - `squarePaymentLink99: "https://square.link/..."`

## 2) Intake Data Setup (Supabase recommended)

### Scenario A: Free intake flow

1. Create a Supabase project.
2. Create table `intake_submissions` (see `SUPABASE_SETUP.md`).
3. Enable RLS and create insert policy for `anon`.
4. In `app.js`, update:
   - `supabaseUrl: "https://qxdoiixdsxgqxylygkxp.supabase.co"`
   - `supabaseAnonKey: "YOUR_ANON_KEY"`
5. (Optional) Add automation in Make:
   - Trigger from Supabase new rows (or poll/query table)
6. Add AI module (OpenAI/Anthropic HTTP call).
7. System prompt: use `prompts.md` content.
8. User prompt: map form fields (`name`, `email`, `phone`, `description`).
9. Add email module (Gmail/Resend):
   - To: mapped `email`
   - Subject: `Your Free Small Claims Case Analysis`
   - Body: summary + action steps + draft messages + both upsell links ($29 and $99).
10. Add Google Sheets/Airtable row:
   - Store name, email, phone, description, timestamp, and status.
11. Turn scenario on.

### Scenario B: Paid flow (optional on day 1)

Square does not need to block launch. Start with manual delivery:
1. In Square dashboard, watch successful payments.
2. Send paid packet manually for first 5-10 buyers.

Then automate:
1. Use a Square integration in Make (or email-trigger parser) to detect payments.
2. Match payment email to lead record.
3. Send paid packet email automatically.

## 3) Vercel Setup (Hosting)

1. Push this folder to GitHub (recommended).
2. In Vercel:
   - **Add New Project** -> import repo.
   - Framework preset: `Other` (static site).
   - Root directory: repo root.
   - Build command: leave empty.
   - Output directory: leave empty.
3. Deploy.

### If you do not want GitHub
- Use `vercel` CLI and run `vercel` in this folder.

## 4) Domain Setup

1. Buy/use domain (example: `smallclaimspro.online`).
2. In Vercel project -> **Settings -> Domains** -> add domain.
3. At registrar, set DNS records exactly as Vercel instructs.
4. Wait for SSL to auto-provision.

## 5) Final Code Changes Before Going Live

Update `app.js`:
- `supabaseUrl`
- `supabaseAnonKey`
- `squarePaymentLink29`
- `squarePaymentLink99`

Optional text updates in `index.html`:
- Business name
- Contact email
- City-specific details

## 6) Must-Have Legal/Trust Items On Page

1. Keep disclaimer visible:
   - "Information and document support only. Not legal advice."
2. Add footer contact email.
3. Add privacy note near form:
   - "By submitting, you agree to be contacted about your request."
4. Avoid claims like "guaranteed win."

## 7) Test Plan (Do This Before Traffic)

1. Fill form with test lead.
2. Confirm webhook receives payload.
3. Confirm AI output quality.
4. Confirm email is delivered (inbox, not spam).
5. Click Square button and complete $1 test or real low-price test link.
6. Confirm payment appears in Square dashboard.
7. Confirm your paid delivery process (manual or automated) works.
8. Test on mobile.

## 8) Launch Sequence (Same Day)

1. Deploy on Vercel.
2. Connect domain.
3. Run end-to-end test.
4. DM local providers.
5. Post in 1-2 local groups.
6. Send first 10-20 visitors to the page.

## 9) Tracking (Minimum)

Track these from day 1:
- Visitors
- Form submissions
- Submission rate
- Square checkouts started
- Square payments completed
- Paid conversion rate

If no analytics yet, track manually in a sheet with timestamps.

## 10) Failure-Proof Day 1 Rules

1. Keep paid fulfillment manual first if automation is unstable.
2. Review every AI output before sending for first batch.
3. Reply fast to every lead (under 15 minutes if possible).
4. Do not expand features until at least one paid conversion.
