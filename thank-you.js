(function () {
  const SHARE_URL = "https://smallclaimspro.online/";
  const SHARE_TEXT =
    "If you're owed money in small claims, SmallClaimsPro helps with demand letters and filing steps — check it out:";

  function trackEvent(eventName, props) {
    var trackingProps = Object.assign(
      { page_path: window.location.pathname },
      props || {}
    );
    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, trackingProps);
    }
  }

  trackEvent("thank_you_page_view");

  var shareBtn = document.getElementById("referralShareBtn");
  var copyBtn = document.getElementById("referralCopyBtn");
  var statusEl = document.getElementById("referralCopyStatus");

  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      trackEvent("referral_share_clicked", { method: "share_api_attempt" });
      if (navigator.share) {
        navigator
          .share({
            title: "SmallClaimsPro.online",
            text: SHARE_TEXT,
            url: SHARE_URL,
          })
          .then(function () {
            trackEvent("referral_share_completed", { method: "native_share" });
          })
          .catch(function () {
            trackEvent("referral_share_cancelled", {});
          });
      } else {
        copyLink();
        trackEvent("referral_share_fallback_copy", {});
      }
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      copyLink();
      trackEvent("referral_copy_link_clicked", {});
    });
  }

  function copyLink() {
    var text = SHARE_URL;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (statusEl) {
          statusEl.textContent = "Link copied. Paste it in a text or DM.";
        }
        trackEvent("referral_copy_success", {});
      });
    } else {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        if (statusEl) {
          statusEl.textContent = "Link copied.";
        }
        trackEvent("referral_copy_success", { fallback: "exec" });
      } catch (e) {
        if (statusEl) {
          statusEl.textContent = "Copy this link: " + text;
        }
      }
      document.body.removeChild(ta);
    }
  }
})();
