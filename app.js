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
const splashIntro = document.getElementById("splashIntro");
const splashEnterBtn = document.getElementById("splashEnterBtn");
const splashHeadline = document.getElementById("splashHeadline");
const SUBMIT_THROTTLE_MS = 60 * 1000;
const SUBMIT_STORAGE_KEY = "scp:last-submit-at";
const MIN_FORM_AGE_MS = 4000;
const TRACKING_SESSION_KEY = "scp:tracking-session-id";
const SPLASH_VARIANT_KEY = "scp:splash-variant";
const SPLASH_TAGLINES = [
  "Let's get your money back.",
  "Small claims made easy.",
  "Your path to getting paid starts now.",
];
let isSubmitting = false;
let formStartedTracked = false;
let splashOpened = false;

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
initSplashIntro();
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
    statusEl.textContent =
      "Submission failed. Update Supabase config in app.js or try again in a minute.";
    trackEvent("intake_submit_error");
    console.error(error);
  } finally {
    isSubmitting = false;
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

function initSplashIntro() {
  if (!splashIntro) {
    return;
  }

  const variant = applySplashTaglineVariant();
  trackEvent("splash_variant_viewed", { variant });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const autoOpenDelay = reduceMotion ? 250 : 1800;
  window.setTimeout(openSplash, autoOpenDelay);

  if (splashEnterBtn) {
    splashEnterBtn.addEventListener("click", openSplash);
  }
}

function openSplash() {
  if (!splashIntro || splashOpened) {
    return;
  }
  splashOpened = true;
  splashIntro.classList.add("is-open");
  trackEvent("splash_intro_opened");
}

function applySplashTaglineVariant() {
  let variant = sessionStorage.getItem(SPLASH_VARIANT_KEY);
  if (!variant) {
    variant = String(Math.floor(Math.random() * SPLASH_TAGLINES.length));
    sessionStorage.setItem(SPLASH_VARIANT_KEY, variant);
  }

  const variantIndex = Number(variant);
  const safeIndex =
    Number.isInteger(variantIndex) && variantIndex >= 0 && variantIndex < SPLASH_TAGLINES.length
      ? variantIndex
      : 0;

  if (splashHeadline) {
    splashHeadline.textContent = SPLASH_TAGLINES[safeIndex];
  }
  return `v${safeIndex + 1}`;
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

    const raw =
      Number(q1.value) + Number(q2.value) + Number(q3.value) + Number(q4.value);
    let band = "needs_work";
    if (raw >= 10) {
      band = "strong";
    } else if (raw >= 7) {
      band = "moderate";
    }

    const copy = {
      strong:
        "<p><strong>Snapshot: stronger position</strong></p><p>You likely have enough structure to move fast: tighten your demand, organize proof, and file if there is no response. Submit the free analysis below for a tailored plan.</p>",
      moderate:
        "<p><strong>Snapshot: workable case</strong></p><p>There are gaps to close — usually proof, timeline, or a clear demand. The free analysis below helps you prioritize the next steps.</p>",
      needs_work:
        "<p><strong>Snapshot: needs more groundwork</strong></p><p>Focus on documents, dates, and a written demand before filing. Use the form below — we will map what to gather first.</p>",
    };

    resultEl.hidden = false;
    resultEl.className = "case-quiz-result case-quiz-result--" + band;
    resultEl.innerHTML = copy[band];
    trackEvent("case_quiz_completed", {
      case_score_band: band,
      case_score_raw: String(raw),
    });
  });
}

if (form) {
  form.addEventListener("submit", handleSubmit);
}
