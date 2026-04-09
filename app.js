const CONFIG = {
  supabaseUrl: "https://qxdoiixdsxgqxylygkxp.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4ZG9paXhkc3hncXh5bHlna3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1NjgzNTQsImV4cCI6MjA5MTE0NDM1NH0.KR-zL9Imx-uj_9-k5NLP5G19cg6OU1QJ9XrKfotLB0c",
  supabaseTable: "intake_submissions",
  edgeFunctionName: "process-intake-submission",
  squarePaymentLink29: "https://square.link/u/Y6Wb0XPx",
  squarePaymentLink99: "https://square.link/u/vSbyYSIn",
  thankYouUrl: "./thank-you.html",
};

const form = document.getElementById("intakeForm");
const statusEl = document.getElementById("formStatus");
const paidCta29 = document.getElementById("paidCta29");
const paidCta99 = document.getElementById("paidCta99");
const headerCta = document.getElementById("headerCta");
const heroPrimaryCta = document.getElementById("heroPrimaryCta");
const heroSecondaryCta = document.getElementById("heroSecondaryCta");
const mobileStickyCta = document.getElementById("mobileStickyCta");
const yearEl = document.getElementById("year");
const SUBMIT_THROTTLE_MS = 60 * 1000;
const SUBMIT_STORAGE_KEY = "scp:last-submit-at";
const MIN_FORM_AGE_MS = 4000;
const TRACKING_SESSION_KEY = "scp:tracking-session-id";
let isSubmitting = false;
let formStartedTracked = false;

if (paidCta29 && CONFIG.squarePaymentLink29.startsWith("http")) {
  paidCta29.href = CONFIG.squarePaymentLink29;
}

if (paidCta99 && CONFIG.squarePaymentLink99.startsWith("http")) {
  paidCta99.href = CONFIG.squarePaymentLink99;
}

if (paidCta29) {
  paidCta29.addEventListener("click", () => {
    trackEvent("upsell_29_clicked");
  });
}

if (paidCta99) {
  paidCta99.addEventListener("click", () => {
    trackEvent("upsell_99_clicked");
  });
}

if (headerCta) {
  headerCta.addEventListener("click", () => {
    trackEvent("header_cta_clicked");
  });
}

if (heroPrimaryCta) {
  heroPrimaryCta.addEventListener("click", () => {
    trackEvent("hero_primary_cta_clicked");
  });
}

if (heroSecondaryCta) {
  heroSecondaryCta.addEventListener("click", () => {
    trackEvent("hero_secondary_cta_clicked");
  });
}

if (mobileStickyCta) {
  mobileStickyCta.addEventListener("click", () => {
    trackEvent("mobile_sticky_cta_clicked");
  });
}

if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}

if (form) {
  const loadedAtInput = form.querySelector('input[name="form_loaded_at"]');
  if (loadedAtInput) {
    loadedAtInput.value = String(Date.now());
  }

  const formInputs = form.querySelectorAll("input, textarea");
  for (const input of formInputs) {
    input.addEventListener("focus", () => {
      if (!formStartedTracked) {
        formStartedTracked = true;
        trackEvent("intake_form_started");
      }
    });
  }
}

trackEvent("landing_page_view");
initCaseQuiz();

async function handleSubmit(event) {
  event.preventDefault();
  if (isSubmitting) {
    trackEvent("intake_submit_blocked_busy");
    return;
  }

  const nowMs = Date.now();
  const lastSubmit = Number(localStorage.getItem(SUBMIT_STORAGE_KEY) || 0);
  if (lastSubmit && nowMs - lastSubmit < SUBMIT_THROTTLE_MS) {
    statusEl.textContent = "Please wait one minute before submitting again.";
    trackEvent("intake_submit_blocked_throttle");
    return;
  }

  if (!form.checkValidity()) {
    statusEl.textContent = "Please complete the required fields.";
    trackEvent("intake_submit_blocked_validation");
    return;
  }

  const formData = new FormData(form);
  const fallbackFormData = new FormData(form);
  const honeypotValue = String(formData.get("company_website") || "").trim();
  if (honeypotValue) {
    statusEl.textContent = "Submission blocked.";
    trackEvent("intake_submit_blocked_honeypot");
    return;
  }

  const formLoadedAt = Number(formData.get("form_loaded_at") || 0);
  if (!formLoadedAt || nowMs - formLoadedAt < MIN_FORM_AGE_MS) {
    statusEl.textContent = "Please wait a few seconds, then try again.";
    trackEvent("intake_submit_blocked_speed");
    return;
  }

  const payload = Object.fromEntries(formData.entries());
  payload.email = normalizeEmail(payload.email);
  payload.phone = normalizePhone(payload.phone);
  payload.source = "smallclaimspro-online-v1";
  payload.createdAt = new Date().toISOString();
  delete payload.company_website;
  delete payload.form_loaded_at;
  delete payload["form-name"];

  if (!isValidEmail(payload.email)) {
    statusEl.textContent = "Please enter a valid email address.";
    trackEvent("intake_submit_blocked_email");
    return;
  }

  isSubmitting = true;
  statusEl.textContent = "Submitting...";
  trackEvent("intake_submit_started");

  try {
    if (
      !CONFIG.supabaseUrl.startsWith("http") ||
      !CONFIG.supabaseAnonKey ||
      CONFIG.supabaseAnonKey.includes("REPLACE_WITH")
    ) {
      throw new Error("Supabase config is not set.");
    }

    const response = await fetch(
      `${CONFIG.supabaseUrl}/rest/v1/${CONFIG.supabaseTable}`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify([
        {
          name: payload.name || "",
          email: payload.email || "",
          phone: payload.phone || "",
          description: payload.description || "",
          consent: Boolean(payload.consent),
          source: payload.source,
          created_at: payload.createdAt,
        },
      ]),
    }
    );

    if (!response.ok) {
      throw new Error(`Supabase insert failed with status ${response.status}.`);
    }

    await notifyEdgeFunction(payload);
    localStorage.setItem(SUBMIT_STORAGE_KEY, String(nowMs));
    trackEvent("intake_submit_success");
    statusEl.textContent = "Analysis request received. Check your email soon.";
    form.reset();
    setTimeout(() => {
      if (CONFIG.thankYouUrl) {
        window.location.href = CONFIG.thankYouUrl;
      }
    }, 500);
  } catch (error) {
    console.error(error);
    const fallbackSubmitted = await submitNetlifyFallback(fallbackFormData);
    if (fallbackSubmitted) {
      localStorage.setItem(SUBMIT_STORAGE_KEY, String(nowMs));
      trackEvent("intake_submit_success_fallback");
      statusEl.textContent = "Request received. Redirecting...";
      form.reset();
      setTimeout(() => {
        if (CONFIG.thankYouUrl) {
          window.location.href = CONFIG.thankYouUrl;
        }
      }, 500);
    } else {
      statusEl.textContent =
        "Submission failed. Please email support@smallclaimspro.online and we will help immediately.";
      trackEvent("intake_submit_error");
    }
  } finally {
    isSubmitting = false;
  }
}

async function submitNetlifyFallback(formData) {
  try {
    const body = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      if (key === "company_website" && String(value).trim()) {
        return false;
      }
      body.append(key, String(value));
    }

    const response = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return response.ok;
  } catch (error) {
    console.error("Netlify fallback failed.", error);
    return false;
  }
}

async function notifyEdgeFunction(payload) {
  if (!CONFIG.edgeFunctionName) {
    return;
  }

  const response = await fetch(
    `${CONFIG.supabaseUrl}/functions/v1/${CONFIG.edgeFunctionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
      },
      body: JSON.stringify(payload),
    }
  );

  // Do not block intake persistence if function is not deployed yet.
  if (!response.ok && response.status !== 404) {
    console.warn("Edge Function call failed.", response.status);
    trackEvent("intake_edge_function_error");
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return `+${digits}`;
}

function trackEvent(eventName, props = {}) {
  const trackingProps = {
    ...props,
    session_id: getTrackingSessionId(),
    page_path: window.location.pathname,
  };

  if (typeof window.plausible === "function") {
    window.plausible(eventName, { props: trackingProps });
  }
  if (typeof window.gtag === "function") {
    window.gtag("event", eventName, trackingProps);
  }
}

function getTrackingSessionId() {
  let sessionId = sessionStorage.getItem(TRACKING_SESSION_KEY);
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(TRACKING_SESSION_KEY, sessionId);
  }
  return sessionId;
}

let caseQuizStarted = false;

function initCaseQuiz() {
  const quizRoot = document.getElementById("caseQuizForm");
  const submitBtn = document.getElementById("caseQuizSubmit");
  const resultEl = document.getElementById("caseQuizResult");
  if (!quizRoot || !submitBtn || !resultEl) {
    return;
  }

  quizRoot.addEventListener("change", (event) => {
    const target = event.target;
    if (target && target.matches('input[type="radio"]') && !caseQuizStarted) {
      caseQuizStarted = true;
      trackEvent("case_quiz_started");
    }
  });

  submitBtn.addEventListener("click", () => {
    const q1 = quizRoot.querySelector('input[name="q1"]:checked');
    const q2 = quizRoot.querySelector('input[name="q2"]:checked');
    const q3 = quizRoot.querySelector('input[name="q3"]:checked');
    const q4 = quizRoot.querySelector('input[name="q4"]:checked');
    if (!q1 || !q2 || !q3 || !q4) {
      resultEl.hidden = false;
      resultEl.className = "case-quiz-result case-quiz-result--warn";
      resultEl.innerHTML =
        "<p><strong>Answer all four questions</strong> to see a quick snapshot.</p>";
      trackEvent("case_quiz_incomplete");
      return;
    }

    const scores = {
      amount: Number(q1.value),
      proof: Number(q2.value),
      paperTrail: Number(q3.value),
      demand: Number(q4.value),
    };
    const weighted = scores.amount + scores.proof * 2 + scores.paperTrail * 2 + scores.demand * 2;
    let band = "needs_work";
    if (weighted >= 17) {
      band = "strong";
    } else if (weighted >= 12) {
      band = "moderate";
    }

    const copy = {
      strong:
        "<p><strong>Snapshot: stronger position</strong></p><p>You have enough structure to move quickly. Tighten your demand letter, finalize your timeline, and prepare filing documents.</p><p><strong>Next:</strong> Submit the form for a tailored action plan and checklist.</p>",
      moderate:
        "<p><strong>Snapshot: workable with gaps</strong></p><p>Your case can improve fast if you close gaps in proof, timeline clarity, or written demands.</p><p><strong>Next:</strong> Submit the form and we will prioritize exactly what to fix first.</p>",
      needs_work:
        "<p><strong>Snapshot: needs groundwork first</strong></p><p>Right now, filing may be premature. Build evidence, lock your timeline, and send a proper written demand before court.</p><p><strong>Next:</strong> Submit the form for a step-by-step prep plan.</p>",
    };

    resultEl.hidden = false;
    resultEl.className = "case-quiz-result case-quiz-result--" + band;
    resultEl.innerHTML = copy[band];
    trackEvent("case_quiz_completed", {
      case_score_band: band,
      case_score_raw: String(weighted),
    });
  });
}

if (form) {
  form.addEventListener("submit", handleSubmit);
}
