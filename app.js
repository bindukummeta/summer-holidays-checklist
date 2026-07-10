(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "summer.state.v1";

  const checklistEl = $("checklist");
  const chipsEl = $("chips");
  const allDoneEl = $("all-done");
  const heroEmoji = $("hero-emoji");
  const heroBarFill = $("hero-bar-fill");
  const heroTitle = $("hero-title");
  const heroSub = $("hero-sub");
  const heroCount = $("hero-count");

  let activeFilter = "all"; // "all" | "today" | a category name
  let lastPct = 0;

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

  // A friendly line + a growing plant/sun emoji that changes with progress.
  function heroMood(pct) {
    if (pct === 0) return ["🌱", "Let's get started!", "Tick things off as you go"];
    if (pct === 100) return ["🎉", "You did it all!", "Every single thing is ticked"];
    if (pct < 25) return ["🌤️", "Great start!", "Keep the momentum going"];
    if (pct < 50) return ["🌻", "Nicely going!", "You're building a good streak"];
    if (pct < 75) return ["🏖️", "Halfway there!", "Loads of summer sorted already"];
    return ["🚀", "Almost there!", "Just a few left — you've got this"];
  }

  // Update a single section's header count + mini bar, and its complete state.
  function updateSection(section) {
    const boxes = section.querySelectorAll('input[type="checkbox"]');
    const done = [...boxes].filter((b) => b.checked).length;
    const total = boxes.length;
    const allDone = total && done === total;
    section.classList.toggle("complete", !!allDone);
    const countEl = section.querySelector(".sec-count");
    const barEl = section.querySelector(".sec-bar-fill");
    if (countEl) countEl.textContent = done + "/" + total;
    if (barEl) barEl.style.width = (total ? (done / total) * 100 : 0) + "%";
  }

  function updateProgress() {
    const boxes = checklistEl.querySelectorAll('input[type="checkbox"]');
    const total = boxes.length;
    const done = [...boxes].filter((b) => b.checked).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    heroBarFill.style.width = pct + "%";
    heroCount.textContent = done + " of " + total;

    const [emoji, title, sub] = heroMood(pct);
    heroTitle.textContent = title;
    // Rebuild the sub line keeping the bold count element intact.
    heroSub.innerHTML = "";
    heroSub.append(heroCount, document.createTextNode(" · " + sub));
    if (heroEmoji.textContent !== emoji) {
      heroEmoji.textContent = emoji;
      heroEmoji.classList.remove("pop");
      void heroEmoji.offsetWidth; // restart the pop animation
      heroEmoji.classList.add("pop");
    }

    allDoneEl.classList.toggle("hidden", pct !== 100);
    if (pct === 100 && lastPct !== 100) burstConfetti();
    lastPct = pct;
  }

  // Render the filter chips: All, Today (daily), then one per category.
  function renderChips() {
    chipsEl.innerHTML = "";
    const defs = [
      { key: "all", label: "All" },
      { key: "today", label: "Today" },
      ...CHECKLIST.map((g) => ({ key: g.category, label: g.category, color: g.color })),
    ];
    defs.forEach((d) => {
      const chip = document.createElement("button");
      chip.className = "chip" + (activeFilter === d.key ? " active" : "");
      chip.textContent = d.label;
      if (d.color && activeFilter === d.key) chip.style.borderColor = d.color;
      chip.addEventListener("click", () => {
        activeFilter = d.key;
        render();
      });
      chipsEl.appendChild(chip);
    });
  }

  // Should this group show under the current filter?
  function groupVisible(group) {
    if (activeFilter === "all") return true;
    if (activeFilter === "today") return !!group.daily;
    return group.category === activeFilter;
  }

  function render() {
    const ticks = loadState().ticks || {};
    renderChips();
    checklistEl.innerHTML = "";

    CHECKLIST.filter(groupVisible).forEach((group) => {
      const section = document.createElement("div");
      section.className = "checklist-group";
      if (group.daily) section.classList.add("is-daily");
      if (group.color) section.style.setProperty("--accent", group.color);
      // Start collapsed unless a single category is filtered into view.
      if (activeFilter === "all" || activeFilter === "today") {
        section.classList.add("collapsed");
      }

      const h = document.createElement("button");
      h.className = "group-head";
      h.innerHTML =
        '<span class="sec-title"></span>' +
        '<span class="sec-meta"><span class="sec-count"></span>' +
        '<span class="sec-bar"><span class="sec-bar-fill"></span></span>' +
        '<span class="sec-caret">▸</span></span>';
      h.querySelector(".sec-title").textContent = group.category;
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

  // Lightweight confetti burst (no library). Draws to the full-screen canvas.
  function burstConfetti() {
    const canvas = $("confetti");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ["#ff8a5c", "#4f9dff", "#37d39a", "#ffb020", "#f76fb0", "#7c8cff"];
    const pieces = Array.from({ length: 120 }, () => ({
      x: canvas.width / 2,
      y: canvas.height / 3,
      vx: (Math.random() - 0.5) * 12,
      vy: Math.random() * -12 - 4,
      size: Math.random() * 8 + 4,
      color: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    }));
    let frame = 0;
    (function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.vy += 0.35; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });
      if (++frame < 120) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    })();
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
