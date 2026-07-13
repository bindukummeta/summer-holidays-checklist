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

  // Palette reused for user-created categories (cycles through as more are added).
  const CATEGORY_COLORS = [
    "#ffb59e", "#a6cdf5", "#c3b8f0", "#a3ddc4", "#f6c88a", "#f2aecb",
  ];

  // ---- User content stored in localStorage (keeps checklist-data.js untouched) ----
  // customItems: { [category]: string[] }  — extra items added to a category
  // customCategories: [{ category, color }] — brand-new categories
  // removed: { [key]: true }               — built-in/custom items hidden by the user
  function getCustomItems() {
    return loadState().customItems || {};
  }
  function getCustomCategories() {
    return loadState().customCategories || [];
  }
  function getRemoved() {
    return loadState().removed || {};
  }

  // Merge built-in CHECKLIST with user categories/items, dropping removed items.
  // Returns the same group shape render() already expects.
  function buildModel() {
    const customItems = getCustomItems();
    const removed = getRemoved();
    const groups = [
      ...CHECKLIST,
      ...getCustomCategories().map((c) => ({
        category: c.category,
        color: c.color,
        custom: true,
        items: [],
      })),
    ];
    return groups.map((g) => {
      const extra = customItems[g.category] || [];
      const items = [...g.items, ...extra].filter(
        (name) => !removed[keyFor(g.category, name)]
      );
      return Object.assign({}, g, { items });
    });
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
  function renderChips(model) {
    chipsEl.innerHTML = "";
    const defs = [
      { key: "all", label: "All" },
      { key: "today", label: "Today" },
      ...model.map((g) => ({ key: g.category, label: g.category, color: g.color })),
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
    const model = buildModel();
    renderChips(model);
    checklistEl.innerHTML = "";

    model.filter(groupVisible).forEach((group) => {
      const section = document.createElement("div");
      section.className = "checklist-group";
      if (group.daily) section.classList.add("is-daily");
      if (group.color) section.style.setProperty("--accent", group.color);
      // In the combined "all"/"today" views, start each category collapsed so the
      // single column stays a compact, scannable list. Filtering to one category
      // (via a chip) shows it expanded.
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

        const del = document.createElement("button");
        del.type = "button";
        del.className = "row-del";
        del.textContent = "✕";
        del.setAttribute("aria-label", "Delete " + name);
        del.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          deleteItem(group.category, name);
        });

        row.append(box, text, del);
        rows.appendChild(row);
      });

      rows.appendChild(buildAddItemRow(group.category));

      checklistEl.appendChild(section);
      updateSection(section);
    });

    checklistEl.appendChild(buildAddCategoryControl());

    updateProgress();
  }

  // A row at the bottom of each section for typing a new item into that category.
  function buildAddItemRow(category) {
    const wrap = document.createElement("form");
    wrap.className = "add-item-row";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "add-item-input";
    input.placeholder = "Add an item…";
    input.maxLength = 80;
    const add = document.createElement("button");
    add.type = "submit";
    add.className = "add-item-btn";
    add.textContent = "＋";
    add.setAttribute("aria-label", "Add item to " + category);
    wrap.addEventListener("submit", (e) => {
      e.preventDefault();
      addItem(category, input.value);
    });
    wrap.append(input, add);
    return wrap;
  }

  // A control at the very bottom for creating a brand-new category.
  function buildAddCategoryControl() {
    const wrap = document.createElement("form");
    wrap.className = "add-category";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "add-item-input";
    input.placeholder = "New category name…";
    input.maxLength = 40;
    const add = document.createElement("button");
    add.type = "submit";
    add.className = "add-category-btn";
    add.textContent = "＋ New category";
    wrap.addEventListener("submit", (e) => {
      e.preventDefault();
      addCategory(input.value);
    });
    wrap.append(input, add);
    return wrap;
  }

  // ---- Mutations on user content ----
  function addItem(category, rawName) {
    const name = (rawName || "").trim();
    if (!name) return;
    const model = buildModel();
    const group = model.find((g) => g.category === category);
    if (group && group.items.includes(name)) return; // no duplicates in view

    const customItems = getCustomItems();
    const list = customItems[category] ? customItems[category].slice() : [];
    if (!list.includes(name)) list.push(name);
    customItems[category] = list;

    // If this exact item was previously removed, un-remove it.
    const removed = getRemoved();
    delete removed[keyFor(category, name)];

    saveState({ customItems, removed });
    render();
  }

  function addCategory(rawName) {
    const name = (rawName || "").trim();
    if (!name) return;
    const existing = buildModel().some((g) => g.category === name);
    if (existing) return; // don't clash with an existing category name

    const cats = getCustomCategories().slice();
    const color = CATEGORY_COLORS[cats.length % CATEGORY_COLORS.length];
    cats.push({ category: name, color });
    saveState({ customCategories: cats });
    activeFilter = name;
    render();
  }

  function deleteItem(category, name) {
    // Drop from custom items if present…
    const customItems = getCustomItems();
    if (customItems[category]) {
      customItems[category] = customItems[category].filter((n) => n !== name);
      if (customItems[category].length === 0) delete customItems[category];
    }
    // …and always record it as removed so a built-in also disappears.
    const removed = getRemoved();
    removed[keyFor(category, name)] = true;
    // Clear any tick so progress stays accurate.
    const ticks = loadState().ticks || {};
    delete ticks[keyFor(category, name)];

    saveState({ customItems, removed, ticks });
    render();
  }

  // Lightweight confetti burst (no library). Draws to the full-screen canvas.
  function burstConfetti() {
    const canvas = $("confetti");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ["#ffb59e", "#a6cdf5", "#a3ddc4", "#f6c88a", "#f2aecb", "#c3b8f0"];
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
    buildModel()
      .filter((g) => g.daily)
      .forEach((g) => {
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
