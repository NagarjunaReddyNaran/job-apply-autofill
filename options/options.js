// options.js

let editingProfile = null; // in-memory working copy; written to storage on Save

function renderForm(profile) {
  const form = document.getElementById("profileForm");
  form.innerHTML = "";
  for (const field of window.PROFILE_FIELDS) {
    const label = document.createElement("label");
    label.textContent = field.label;

    if (field.type === "boolean") {
      const select = document.createElement("select");
      select.id = "field_" + field.key;
      select.innerHTML = `
        <option value="">— not set —</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      `;
      select.value = profile[field.key] === true ? "true" : profile[field.key] === false ? "false" : "";
      label.appendChild(select);
    } else {
      const input = document.createElement("input");
      input.type = field.type === "email" ? "email" : field.type === "number" ? "number" : "text";
      input.id = "field_" + field.key;
      input.value = profile[field.key] || "";
      label.appendChild(input);
    }
    form.appendChild(label);
  }
}

function readFormIntoProfile(existing) {
  const profile = { ...existing };
  for (const field of window.PROFILE_FIELDS) {
    const el = document.getElementById("field_" + field.key);
    if (!el) continue;
    if (field.type === "boolean") {
      profile[field.key] = el.value === "" ? null : el.value === "true";
    } else {
      profile[field.key] = el.value;
    }
  }
  profile.snippets = { ...(existing.snippets || {}), whyThisCompany: document.getElementById("snippetWhy").value };
  profile.enableEeoAutofill = document.getElementById("enableEeo").checked;
  profile.highlightFields = document.getElementById("highlightFields").checked;
  return profile;
}

function renderEntryList(collectionKey, containerId, fieldDefs, entryLabel) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  const entries = editingProfile[collectionKey] || [];

  entries.forEach((entry, index) => {
    const card = document.createElement("div");
    card.className = "entry-card";

    const heading = document.createElement("div");
    heading.style.fontWeight = "600";
    heading.style.fontSize = "13px";
    heading.style.marginBottom = "6px";
    heading.textContent = `${entryLabel} ${index + 1}`;
    card.appendChild(heading);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-entry";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      editingProfile[collectionKey].splice(index, 1);
      renderEntryList(collectionKey, containerId, fieldDefs, entryLabel);
    });
    card.appendChild(removeBtn);

    const grid = document.createElement("div");
    grid.className = "entry-grid";

    for (const fdef of fieldDefs) {
      const label = document.createElement("label");
      label.textContent = fdef.label;

      let input;
      if (fdef.type === "boolean") {
        input = document.createElement("select");
        input.innerHTML = `<option value="">— not set —</option><option value="true">Yes</option><option value="false">No</option>`;
        input.value = entry[fdef.key] === true ? "true" : entry[fdef.key] === false ? "false" : "";
        input.addEventListener("change", () => {
          entry[fdef.key] = input.value === "" ? null : input.value === "true";
        });
      } else if (fdef.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = 3;
        input.value = entry[fdef.key] || "";
        input.addEventListener("input", () => { entry[fdef.key] = input.value; });
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.value = entry[fdef.key] || "";
        input.placeholder = fdef.placeholder || "";
        input.addEventListener("input", () => { entry[fdef.key] = input.value; });
      }
      label.appendChild(input);
      grid.appendChild(label);
    }

    card.appendChild(grid);
    container.appendChild(card);
  });
}

const WORK_EXPERIENCE_FIELD_DEFS = [
  { key: "jobTitle", label: "Job Title" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "current", label: "Currently work here?", type: "boolean" },
  { key: "startDate", label: "From (MM/YYYY)", placeholder: "01/2022" },
  { key: "endDate", label: "To (MM/YYYY, blank if current)", placeholder: "01/2024" },
  { key: "description", label: "Role Description", type: "textarea" }
];

const EDUCATION_FIELD_DEFS = [
  { key: "school", label: "School or University" },
  { key: "degree", label: "Degree" },
  { key: "fieldOfStudy", label: "Field of Study" }
];

const LANGUAGE_FIELD_DEFS = [
  { key: "language", label: "Language" },
  { key: "fluent", label: "Fluent?", type: "boolean" },
  { key: "comprehension", label: "Comprehension level" },
  { key: "overall", label: "Overall level" },
  { key: "reading", label: "Reading level" },
  { key: "speaking", label: "Speaking level" },
  { key: "writing", label: "Writing level" }
];

function renderAllEntryLists() {
  renderEntryList("workExperience", "workExperienceList", WORK_EXPERIENCE_FIELD_DEFS, "Experience");
  renderEntryList("education", "educationList", EDUCATION_FIELD_DEFS, "Education");
  renderEntryList("languages", "languagesList", LANGUAGE_FIELD_DEFS, "Language");
}

async function init() {
  editingProfile = await window.getProfile();
  renderForm(editingProfile);
  renderAllEntryLists();

  document.getElementById("snippetWhy").value = editingProfile.snippets?.whyThisCompany || "";
  document.getElementById("enableEeo").checked = !!editingProfile.enableEeoAutofill;
  document.getElementById("highlightFields").checked = editingProfile.highlightFields !== false;

  document.getElementById("addWorkExperience").addEventListener("click", () => {
    editingProfile.workExperience.push(window.emptyWorkExperience());
    renderEntryList("workExperience", "workExperienceList", WORK_EXPERIENCE_FIELD_DEFS, "Experience");
  });
  document.getElementById("addEducation").addEventListener("click", () => {
    editingProfile.education.push(window.emptyEducationEntry());
    renderEntryList("education", "educationList", EDUCATION_FIELD_DEFS, "Education");
  });
  document.getElementById("addLanguage").addEventListener("click", () => {
    editingProfile.languages.push(window.emptyLanguageEntry());
    renderEntryList("languages", "languagesList", LANGUAGE_FIELD_DEFS, "Language");
  });

  document.getElementById("saveBtn").addEventListener("click", async () => {
    editingProfile = readFormIntoProfile(editingProfile);
    await window.saveProfile(editingProfile);
    const msg = document.getElementById("savedMsg");
    msg.classList.remove("hidden");
    setTimeout(() => msg.classList.add("hidden"), 1500);
  });

  document.getElementById("exportBtn").addEventListener("click", async () => {
    window.exportProfileToFile(editingProfile);
  });

  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    editingProfile = await window.importProfileFromFile(file);
    renderForm(editingProfile);
    renderAllEntryLists();
    document.getElementById("snippetWhy").value = editingProfile.snippets?.whyThisCompany || "";
    document.getElementById("enableEeo").checked = !!editingProfile.enableEeoAutofill;
  });
}

init();
