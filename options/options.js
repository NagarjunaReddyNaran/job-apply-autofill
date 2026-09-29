// options.js

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

async function init() {
  const profile = await window.getProfile();
  renderForm(profile);
  document.getElementById("snippetWhy").value = profile.snippets?.whyThisCompany || "";
  document.getElementById("enableEeo").checked = !!profile.enableEeoAutofill;
  document.getElementById("highlightFields").checked = profile.highlightFields !== false;

  document.getElementById("saveBtn").addEventListener("click", async () => {
    const current = await window.getProfile();
    const updated = readFormIntoProfile(current);
    await window.saveProfile(updated);
    const msg = document.getElementById("savedMsg");
    msg.classList.remove("hidden");
    setTimeout(() => msg.classList.add("hidden"), 1500);
  });

  document.getElementById("exportBtn").addEventListener("click", async () => {
    const current = await window.getProfile();
    window.exportProfileToFile(current);
  });

  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const merged = await window.importProfileFromFile(file);
    renderForm(merged);
    document.getElementById("snippetWhy").value = merged.snippets?.whyThisCompany || "";
    document.getElementById("enableEeo").checked = !!merged.enableEeoAutofill;
  });
}

init();
