// profile-schema.js
// Defines the shape of a user's saved profile and sensible defaults.

const PROFILE_FIELDS = [
  { key: "firstName", label: "First name", type: "text" },
  { key: "middleName", label: "Middle name", type: "text" },
  { key: "lastName", label: "Last name", type: "text" },
  { key: "preferredName", label: "Preferred name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "address", label: "Street address", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "state", label: "State / Province", type: "text" },
  { key: "postalCode", label: "ZIP / Postal code", type: "text" },
  { key: "country", label: "Country", type: "text" },
  { key: "linkedin", label: "LinkedIn URL", type: "url" },
  { key: "github", label: "GitHub URL", type: "url" },
  { key: "portfolio", label: "Portfolio URL", type: "url" },
  { key: "currentCompany", label: "Current company", type: "text" },
  { key: "currentTitle", label: "Current job title", type: "text" },
  { key: "yearsExperience", label: "Years of experience", type: "number" },
  { key: "degree", label: "Degree", type: "text" },
  { key: "university", label: "University", type: "text" },
  { key: "graduationYear", label: "Graduation year", type: "text" },
  { key: "workAuthorization", label: "Authorized to work in your country? (yes/no)", type: "boolean" },
  { key: "requiresSponsorship", label: "Will you require sponsorship? (yes/no)", type: "boolean" },
  { key: "willingToRelocate", label: "Willing to relocate? (yes/no)", type: "boolean" },
  { key: "preferredLocations", label: "Preferred locations", type: "text" }
];

function defaultProfile() {
  const profile = {};
  for (const f of PROFILE_FIELDS) {
    profile[f.key] = f.type === "boolean" ? null : "";
  }
  profile.snippets = {}; // e.g. { whyThisCompany: "..." }
  profile.enableEeoAutofill = false; // explicit opt-in, never inferred
  profile.highlightFields = true;
  return profile;
}

if (typeof window !== "undefined") {
  window.PROFILE_FIELDS = PROFILE_FIELDS;
  window.defaultProfile = defaultProfile;
}
if (typeof module !== "undefined") {
  module.exports = { PROFILE_FIELDS, defaultProfile };
}
