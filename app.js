(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "summer.state.v1";

  const checklistEl = $("checklist");
  const progressBadge = $("progress-badge");
  const allDoneEl = $("all-done");

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (_) {
      return {};
    }
  }
  function saveState(patch) {
    const next = Object.assign(loadState(), patch);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function keyFor(category, name) {
    return [category, name].join("|");
  }

  // Collapse a section once every item is ticked; expand it otherwise.
  function updateSection(section) {
    const boxes = section.querySelectorAll('input[type="checkbox"]');
    const allDone = boxes.length && [...boxes].every((b) => b.checked);
    section.classList.toggle("complete", !!allDone);
    section.classList.toggle("collapsed", !!allDone);
  }

  function updateProgress() {
    const boxes = checklistEl.querySelectorAll('input[type="checkbox"]');
    if (!boxes.length) {
      progressBadge.textContent = "0%";
      allDoneEl.classList.add("hidden");
      return;
    }
    const done = [...boxes].filter((b) => b.checked).length;
    const pct = Math.round((done / boxes.length) * 100);
    progressBadge.textContent = pct + "%";
    allDoneEl.classList.toggle("hidden", pct !== 100);
  }

  function render() {
    const ticks = loadState().ticks || {};
    checklistEl.innerHTML = "";

    CHECKLIST.forEach((group) => {
      const section = document.createElement("div");
      section.className = "checklist-group";
      if (group.daily) section.classList.add("is-daily");

      const h = document.createElement("h3");
      h.textContent = group.category;
      h.addEventListener("click", () => section.classList.toggle("collapsed"));
      section.appendChild(h);

      const rows = document.createElement("div");
      rows.className = "group-rows";
      section.appendChild(rows);

      group.items.forEach((name) => {
        const id = keyFor(group.category, name);
        const row = document.createElement("label");
        row.className = "check-row";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = !!ticks[id];
        box.addEventListener("change", () => {
          const t = loadState().ticks || {};
          t[id] = box.checked;
          saveState({ ticks: t });
          row.classList.toggle("done", box.checked);
          updateSection(section);
          updateProgress();
        });
        if (box.checked) row.classList.add("done");
        const text = document.createElement("span");
        text.className = "check-text";
        text.textContent = name;
        row.append(box, text);
        rows.appendChild(row);
      });

      checklistEl.appendChild(section);
      updateSection(section);
    });

    updateProgress();
  }

  // Clear only the daily-basics ticks (fresh start each day).
  function resetDaily() {
    const ticks = loadState().ticks || {};
    CHECKLIST.filter((g) => g.daily).forEach((g) => {
      g.items.forEach((name) => delete ticks[keyFor(g.category, name)]);
    });
    saveState({ ticks });
    render();
  }

  $("reset-daily").addEventListener("click", resetDaily);
  $("reset-all").addEventListener("click", () => {
    saveState({ ticks: {} });
    render();
  });

  render();
})();
