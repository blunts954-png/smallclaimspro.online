/**
 * State-specific small claims court data for each supported jurisdiction.
 * Used to build state-aware AI prompts and document output.
 */

export const SUPPORTED_STATES = ["CA", "CO", "FL", "NV", "TX"];

export const STATE_DATA = {
  CA: {
    name: "California",
    courtName: "Small Claims Court (Superior Court)",
    claimLimit: "$12,500 (individuals), $6,250 (businesses)",
    filingFees: "$30–$75 depending on claim amount",
    demandLetterNote: "Not legally required but strongly recommended — judges expect evidence of a resolution attempt.",
    sol: {
      written: "4 years (CCP §337)",
      oral: "2 years (CCP §339)",
      property: "3 years (CCP §338)",
      personalInjury: "2 years (CCP §335.1)",
    },
    courtAddress: "File in the Superior Court for the county where the defendant lives or the dispute occurred. Find your county court at the link below.",
    courtUrl: "https://www.courts.ca.gov/selfhelp-smallclaims.htm",
    forms: "SC-100 (Plaintiff's Claim and Order)",
    selfRepNote: "California generally prohibits attorney representation at small claims trials.",
    disclaimer: "For legal representation consult a licensed California attorney.",
  },
  CO: {
    name: "Colorado",
    courtName: "County Court Small Claims Division",
    claimLimit: "$7,500",
    filingFees: "$31–$55 depending on claim amount",
    demandLetterNote: "Not required but strongly recommended before filing.",
    sol: {
      written: "6 years (CRS §13-80-103.5)",
      oral: "3 years (CRS §13-80-101)",
      property: "3 years (CRS §13-80-101)",
      personalInjury: "2 years (CRS §13-80-102)",
    },
    courtAddress: "File in the county court where the defendant lives or the dispute occurred.",
    courtUrl: "https://www.coloradojudicial.gov/courts/county-courts",
    forms: "JDF 250 (Notice, Claim and Summons to Appear)",
    selfRepNote: "Attorneys may appear at trial in Colorado small claims but most cases are self-represented.",
    disclaimer: "For legal representation consult a licensed Colorado attorney.",
  },
  FL: {
    name: "Florida",
    courtName: "County Court Small Claims Division",
    claimLimit: "$8,000",
    filingFees: "$55–$300 depending on claim amount",
    demandLetterNote: "Not required but judges favor plaintiffs who documented a good-faith resolution attempt.",
    sol: {
      written: "5 years (Fla. Stat. §95.11(2)(b))",
      oral: "4 years (Fla. Stat. §95.11(3)(k))",
      property: "4 years (Fla. Stat. §95.11(3)(h))",
      personalInjury: "2 years (Fla. Stat. §95.11(3)(a))",
    },
    courtAddress: "File in the county court for the county where the defendant resides or the transaction occurred.",
    courtUrl: "https://www.flcourts.gov/Resources-Services/Court-Improvement/Court-Technology/Florida-Courts-E-Filing-Portal",
    forms: "Statement of Claim (county-specific form)",
    selfRepNote: "Attorneys may appear. Mediation is often required before trial in Florida small claims.",
    disclaimer: "For legal representation consult a licensed Florida attorney.",
  },
  NV: {
    name: "Nevada",
    courtName: "Justice Court Small Claims Division",
    claimLimit: "$10,000",
    filingFees: "$37–$85 depending on claim amount",
    demandLetterNote: "Not required but demonstrates good faith and strengthens your claim.",
    sol: {
      written: "6 years (NRS §11.190(1)(b))",
      oral: "4 years (NRS §11.190(2))",
      property: "3 years (NRS §11.190(3))",
      personalInjury: "2 years (NRS §11.190(4)(e))",
    },
    courtAddress: "File in the Justice Court for the township where the defendant resides or the dispute arose.",
    courtUrl: "https://www.nevadajudiciary.us/index.php/courts/justice-courts",
    forms: "Small Claims Complaint (township-specific form)",
    selfRepNote: "Attorneys are not allowed to represent parties in Nevada small claims court.",
    disclaimer: "For legal representation consult a licensed Nevada attorney.",
  },
  TX: {
    name: "Texas",
    courtName: "Justice of the Peace Court (Small Claims)",
    claimLimit: "$20,000",
    filingFees: "$46–$100 depending on precinct and claim amount",
    demandLetterNote: "Not legally required but a certified demand letter significantly strengthens your position.",
    sol: {
      written: "4 years (Tex. Civ. Prac. & Rem. Code §16.004)",
      oral: "4 years (Tex. Civ. Prac. & Rem. Code §16.004)",
      property: "4 years (Tex. Civ. Prac. & Rem. Code §16.004)",
      personalInjury: "2 years (Tex. Civ. Prac. & Rem. Code §16.003)",
    },
    courtAddress: "File in the Justice of the Peace precinct where the defendant resides or the incident occurred.",
    courtUrl: "https://www.txcourts.gov/courts/justice-courts/",
    forms: "Original Petition — Small Claims (Form SC-1 or local equivalent)",
    selfRepNote: "Attorneys may appear but most Texas small claims cases are self-represented.",
    disclaimer: "For legal representation consult a licensed Texas attorney.",
  },
};

/**
 * Returns state data for the given state code, falling back to CA if unknown.
 * @param {string} stateCode
 */
export function getStateData(stateCode) {
  const code = String(stateCode || "CA").toUpperCase();
  return STATE_DATA[code] || STATE_DATA.CA;
}

/**
 * Builds the jurisdiction context block injected into AI prompts.
 * @param {string} stateCode
 * @returns {string}
 */
export function buildJurisdictionContext(stateCode) {
  const s = getStateData(stateCode);
  return [
    `Jurisdiction: ${s.name}`,
    `Court: ${s.courtName}`,
    `Claim limit: ${s.claimLimit}`,
    `Filing fees: ${s.filingFees}`,
    `Primary court forms: ${s.forms}`,
    `Demand letter: ${s.demandLetterNote}`,
    `Attorney representation: ${s.selfRepNote}`,
    `SOL written contract: ${s.sol.written}`,
    `SOL oral contract: ${s.sol.oral}`,
    `SOL property damage: ${s.sol.property}`,
    `SOL personal injury: ${s.sol.personalInjury}`,
    `Court filing info: ${s.courtAddress}`,
    `Court website: ${s.courtUrl}`,
  ].join("\n");
}
