// field-classifier.js
// Turns a field's collected signals into { semanticField, confidence }.
// Deterministic keyword matching — no AI/network calls, per the project's
// "build a reliable deterministic engine first" requirement.

(function () {
  // Each semantic field maps to an array of regexes tested against the
  // combined signal text. Earlier/more specific patterns should be listed
  // first within a field since we take the best (highest-weight) match.
  const PATTERNS = {
    firstName: [/\bfirst[\s_-]?name\b/i, /\bgiven[\s_-]?name\b/i, /\blegal[\s_-]?first[\s_-]?name\b/i],
    middleName: [/\bmiddle[\s_-]?name\b/i],
    lastName: [/\blast[\s_-]?name\b/i, /\bsur[\s_-]?name\b/i, /\bfamily[\s_-]?name\b/i],
    preferredName: [/\bpreferred[\s_-]?name\b/i, /\bnickname\b/i],
    email: [/\be[\s_-]?mail\b/i],
    phone: [/\bphone\b/i, /\bmobile\b/i, /\btelephone\b/i, /\bcell\b/i],
    address: [/\bstreet\b/i, /\baddress[\s_-]?line[\s_-]?1\b/i, /\baddress\b/i],
    city: [/\bcity\b/i, /\btown\b/i],
    state: [/\bstate\b/i, /\bprovince\b/i, /\bregion\b/i],
    postalCode: [/\bzip\b/i, /\bpostal[\s_-]?code\b/i, /\bpost[\s_-]?code\b/i],
    country: [/\bcountry\b/i],
    linkedin: [/\blinkedin\b/i],
    github: [/\bgithub\b/i],
    portfolio: [/\bportfolio\b/i, /\bpersonal[\s_-]?website\b/i, /\bwebsite\b/i],
    currentCompany: [/\bcurrent[\s_-]?(employer|company)\b/i, /\bemployer\b/i],
    currentTitle: [/\bjob[\s_-]?title\b/i, /\bcurrent[\s_-]?title\b/i, /\bposition\b/i],
    yearsExperience: [/\byears?[\s_-]?of[\s_-]?experience\b/i, /\bexperience\b/i],
    degree: [/\bdegree\b/i],
    university: [/\buniversity\b/i, /\bcollege\b/i, /\bschool\b/i],
    graduationYear: [/\bgraduation[\s_-]?(year|date)\b/i, /\bgrad[\s_-]?year\b/i],
    workAuthorization: [/\bauthoriz(e|ation)[\s\S]{0,30}\bwork\b/i, /\blegally[\s\S]{0,15}work\b/i],
    requiresSponsorship: [/\bsponsorship\b/i, /\bvisa\b/i],
    willingToRelocate: [/\brelocat/i],
    preferredLocations: [/\bpreferred[\s_-]?location/i]
  };

  function scoreField(signals) {
    // Prioritize the strongest, most explicit signals first.
    const weighted = [
      { text: signals.autocomplete, weight: 1.0 },
      { text: signals.name, weight: 0.9 },
      { text: signals.id, weight: 0.8 },
      { text: signals.labelText, weight: 0.95 },
      { text: signals.ariaLabel, weight: 0.85 },
      { text: signals.placeholder, weight: 0.6 },
      { text: signals.nearbyText, weight: 0.4 }
    ];

    let best = { semanticField: null, confidence: 0 };

    for (const [semanticField, patterns] of Object.entries(PATTERNS)) {
      for (const { text, weight } of weighted) {
        if (!text) continue;
        for (const pattern of patterns) {
          if (pattern.test(text)) {
            const confidence = Math.min(0.99, weight);
            if (confidence > best.confidence) {
              best = { semanticField, confidence };
            }
          }
        }
      }
    }
    return best;
  }

  window.JobApplyClassifier = { classifyField: scoreField, PATTERNS };
})();
