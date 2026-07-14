(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "summer.state.v1";

  const checklistEl = $("checklist");
  const drawerNavEl = $("drawer-nav");
  const drawerEl = $("drawer");
  const drawerOverlayEl = $("drawer-overlay");
  const menuToggleEl = $("menu-toggle");
  const homeEl = $("home");
  const detailEl = $("detail");
  const homeTilesEl = $("home-tiles");
  const allDoneEl = $("all-done");
  const heroEmoji = $("hero-emoji");
  const heroBarFill = $("hero-bar-fill");
  const heroTitle = $("hero-title");
  const heroSub = $("hero-sub");
  const heroCount = $("hero-count");
  const heroEarned = $("hero-earned");
  const plannerEl = $("planner");
  const plannerGridEl = $("planner-grid");
  const plannerTitleEl = $("planner-title");
  const plannerEmptyEl = $("planner-empty");
  const dayPanelEl = $("day-panel");
  const dayPanelOverlayEl = $("day-panel-overlay");
  const dayPanelTitleEl = $("day-panel-title");
  const dayPanelListEl = $("day-panel-list");
  const dayAddFormEl = $("day-add-form");
  const dayAddNameEl = $("day-add-name");
  const dayAddCategoryEl = $("day-add-category");
  const dayAddItemsEl = $("day-add-items");
  const dayAddMsgEl = $("day-add-msg");
  const weatherFormEl = $("weather-form");
  const weatherInputEl = $("weather-postcode");
  const weatherStatusEl = $("weather-status");
  const weatherClearBtnEl = $("weather-clear-btn");

  let activeFilter = "all"; // "all" | a category name
  let currentView = "home"; // "home" | "detail" | "planner"
  // Planner state: which mode and which day anchors the visible range.
  let plannerMode = "week"; // "week" | "month"
  let plannerAnchor = new Date();
  let lastPct = 0;
  // Object URLs created for custom tile photos; revoked on each home re-render.
  let tilePhotoUrls = [];

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

  // ---- Item helpers ----------------------------------------------------------
  // Items are usually plain strings, but in a `paid` (chores) category each item
  // is an object { name, reward }. These helpers normalise both shapes so the
  // rest of the code can treat every item uniformly.
  function itemName(item) {
    return typeof item === "string" ? item : item.name;
  }
  function itemReward(item) {
    return typeof item === "string" ? 0 : Number(item.reward) || 0;
  }
  function isPaid(group) {
    return !!group.paid;
  }
  function formatMoney(n) {
    return "£" + (Number(n) || 0).toFixed(2);
  }
  // Total possible reward across a group's items.
  function totalRewardFor(group) {
    return group.items.reduce((sum, it) => sum + itemReward(it), 0);
  }
  // Reward already earned (items that are ticked) in a group.
  function earnedFor(group, ticks) {
    return group.items.reduce(
      (sum, it) =>
        sum + (ticks[keyFor(group.category, itemName(it))] ? itemReward(it) : 0),
      0
    );
  }

  // ---- Custom tile photos (user uploads) stored in IndexedDB on this device ----
  // Each home tile can have its own photo swapped in by the user. We keep the raw
  // image Blob in IndexedDB (store "tiles", keyed by the tile's `key`) so it
  // survives reloads. Nothing leaves the browser; clearing site data removes them.
  const PHOTO_DB = "summer-photos";
  const PHOTO_STORE = "tiles";
  let photoDbPromise = null;

  function openPhotoDb() {
    if (photoDbPromise) return photoDbPromise;
    photoDbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(PHOTO_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return photoDbPromise;
  }

  function getCustomPhoto(key) {
    return openPhotoDb()
      .then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(PHOTO_STORE, "readonly");
            const req = tx.objectStore(PHOTO_STORE).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
          })
      )
      .catch(() => null);
  }

  function setCustomPhoto(key, blob) {
    return openPhotoDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(PHOTO_STORE, "readwrite");
          tx.objectStore(PHOTO_STORE).put(blob, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function clearCustomPhoto(key) {
    return openPhotoDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(PHOTO_STORE, "readwrite");
          tx.objectStore(PHOTO_STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  // Palette reused for user-created categories (cycles through as more are added).
  const CATEGORY_COLORS = [
    "#ffb59e", "#a6cdf5", "#c3b8f0", "#a3ddc4", "#f6c88a", "#f2aecb",
  ];

  // Turn a category name into a safe key for tile photo storage / IDs.
  function slugify(s) {
    return String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "cat";
  }

  // Pull a leading emoji off a category label (categories are named like
  // "🎯 Daily basics"), so custom-category tiles reuse the user's own emoji.
  function firstEmoji(s) {
    const m = String(s).trim().match(/^([\u203C-\u3299\uD83C-\uDBFF\uDC00-\uDFFF\u2600-\u27BF\u2190-\u21FF\u2B00-\u2BFF\uFE0F\u200D]+)/);
    return m ? m[1].trim() : "";
  }

  // Home-screen tiles — one bright photo per checklist category. `target` matches
  // a category name exactly (see checklist-data.js) so tapping a tile opens that
  // category's checklist.
  // Tile shape flags drive the staggered mosaic on the home screen:
  //   wide: true  → spans the full row as a "featured" banner
  //   tall: true  → rises taller than its neighbour so tiles brick/stagger
  // My Planner leads as a hero banner and Back to school closes as one; every
  // other category (Daily basics and Chores included) sits in the staggered
  // 2-column mosaic, alternating tall/short so the seams offset.
  const HOME_TILES = [
    { key: "planner",      label: "Summer 2026 Planner", emoji: "📅", planner: true, wide: true },
    { key: "daily",        label: "Daily basics",     emoji: "🎯", target: "🎯 Daily basics", tall: true },
    { key: "chores",       label: "Chores",           emoji: "💰", target: "💰 Chores" },
    { key: "activities",   label: "Days out",         emoji: "🗓️", target: "🗓️ Activities & days out", tall: true },
    { key: "rainy",        label: "Rainy-day ideas",  emoji: "🌧️", target: "🌧️ Rainy-day ideas" },
    { key: "daybag",       label: "Day-out bag",      emoji: "🧳", target: "🧳 Day-out bag", tall: true },
    { key: "learning",     label: "Keep learning",    emoji: "📚", target: "📚 Keep learning" },
    { key: "backtoschool", label: "Back to school",   emoji: "✅", target: "✅ Back-to-school prep", wide: true, tail: true },
  ];

  // Default photos rotated onto user-created category tiles so a new category
  // gets a nice picture straight away (users can still swap it via 📷). These are
  // their own bundled, kid-friendly CC0 photos (see images/defaults/CREDITS.json)
  // — kept separate from the built-in category tiles so new categories look
  // distinct rather than repeating an existing tile's photo.
  const DEFAULT_TILE_IMAGES = [
    "images/defaults/art.jpg",
    "images/defaults/cooking.jpg",
    "images/defaults/friends.jpg",
    "images/defaults/play.jpg",
    "images/defaults/children.jpg",
    "images/defaults/sprinkles.jpg",
  ];

  // Photo attribution (Creative Commons) shown in the drawer.
  const PHOTO_CREDITS = [
    { label: "Daily basics", by: "User-provided", lic: "Unknown" },
    { label: "Days out", by: "Knthabrew (Wikimedia)", lic: "CC BY-SA 4.0" },
    { label: "Rainy-day ideas", by: "Kristin Hardwick (StockSnap)", lic: "CC0" },
    { label: "Day-out bag", by: "ambermb (Wikimedia)", lic: "CC0" },
    { label: "Keep learning", by: "Direct Media (StockSnap)", lic: "CC0" },
    { label: "Back to school", by: "Artsy Crafty (StockSnap)", lic: "CC0" },
    { label: "Summer 2026 Planner", by: "Beauty and Fashion (StockSnap)", lic: "CC0" },
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

  // dates: { [key]: string[] } — planned "YYYY-MM-DD" days assigned to an item,
  // keyed by keyFor(category, name) just like ticks. An item can hold several.
  function getDates() {
    return loadState().dates || {};
  }
  function getItemDates(id) {
    const list = getDates()[id];
    return Array.isArray(list) ? list.slice().sort() : [];
  }
  function setItemDates(id, list) {
    const dates = getDates();
    const clean = Array.from(new Set(list)).filter(Boolean).sort();
    if (clean.length) dates[id] = clean;
    else delete dates[id];
    saveState({ dates });
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
        (it) => !removed[keyFor(g.category, itemName(it))]
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
    // Paid (chores) sections also show the money earned so far.
    if (section.dataset.paid === "1") {
      const earned = [...boxes]
        .filter((b) => b.checked)
        .reduce((sum, b) => sum + (Number(b.dataset.reward) || 0), 0);
      const earnedEl = section.querySelector(".sec-earned");
      if (earnedEl) earnedEl.textContent = formatMoney(earned);
    }
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

    // Banked money: the running total the child has earned from chores. Unlike
    // the per-section badge (which shows what's ticked right now), this total is
    // kept across the daily reset, so it only grows over the summer. Show it in
    // the hero whenever there's money banked or any chore is on screen.
    if (heroEarned) {
      const banked = Number(loadState().earnedTotal) || 0;
      const hasRewardBoxes = checklistEl.querySelector("input[data-reward]");
      if (banked > 0 || hasRewardBoxes) {
        heroEarned.textContent = "💰 Banked " + formatMoney(banked);
        heroEarned.classList.remove("hidden");
      } else {
        heroEarned.classList.add("hidden");
      }
    }

    allDoneEl.classList.toggle("hidden", pct !== 100);
    if (pct === 100 && lastPct !== 100) burstConfetti();
    lastPct = pct;
  }

  // Remaining (unticked) count for a group under the current stored ticks.
  function remainingFor(group, ticks) {
    return group.items.filter(
      (it) => !ticks[keyFor(group.category, itemName(it))]
    ).length;
  }

  // Render the drawer nav: All, then one entry per category with a colour dot and
  // a count of items still to do.
  function renderDrawer(model, ticks) {
    drawerNavEl.innerHTML = "";
    const totalLeft = model.reduce((n, g) => n + remainingFor(g, ticks), 0);

    const defs = [
      { key: "home", label: "🏠 Home", home: true },
      { key: "planner", label: "📅 My Planner", planner: true },
      { key: "all", label: "All", count: totalLeft },
      ...model.map((g) => ({
        key: g.category,
        label: g.category,
        color: g.color,
        count: remainingFor(g, ticks),
      })),
    ];

    defs.forEach((d) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      const isActive =
        (!d.home && !d.planner && currentView === "detail" && activeFilter === d.key) ||
        (d.planner && currentView === "planner");
      btn.className = "drawer-link" + (isActive ? " active" : "");
      if (d.color) btn.style.setProperty("--accent", d.color);

      const dot = document.createElement("span");
      dot.className = "drawer-dot";
      if (d.color) dot.style.background = d.color;
      if (d.home || d.planner) dot.style.background = "transparent";

      const label = document.createElement("span");
      label.className = "drawer-label";
      label.textContent = d.label;

      const count = document.createElement("span");
      count.className = "drawer-count";
      if (!d.home && !d.planner) count.textContent = d.count ? d.count : "✓";

      btn.append(dot, label, count);
      btn.addEventListener("click", () => {
        closeDrawer();
        if (d.home) {
          showHome();
        } else if (d.planner) {
          showPlanner();
        } else {
          activeFilter = d.key;
          showDetail();
        }
      });
      li.appendChild(btn);
      drawerNavEl.appendChild(li);
    });

    renderDrawerCredits();
  }

  // Small Creative-Commons photo attribution block at the foot of the drawer.
  function renderDrawerCredits() {
    let creditsEl = drawerNavEl.parentElement.querySelector(".drawer-credits");
    if (creditsEl) return; // build once
    creditsEl = document.createElement("div");
    creditsEl.className = "drawer-credits";
    const h = document.createElement("div");
    h.className = "drawer-credits-title";
    h.textContent = "Photo credits";
    creditsEl.appendChild(h);
    PHOTO_CREDITS.forEach((c) => {
      const line = document.createElement("div");
      line.className = "drawer-credit-line";
      line.textContent = `${c.label}: ${c.by} · ${c.lic}`;
      creditsEl.appendChild(line);
    });
    drawerEl.appendChild(creditsEl);
  }

  function openDrawer() {
    drawerOverlayEl.hidden = false;
    // Force reflow so the opacity transition runs from hidden state.
    void drawerOverlayEl.offsetWidth;
    drawerEl.classList.add("open");
    drawerOverlayEl.classList.add("show");
    drawerEl.setAttribute("aria-hidden", "false");
    menuToggleEl.setAttribute("aria-expanded", "true");
  }
  function closeDrawer() {
    drawerEl.classList.remove("open");
    drawerOverlayEl.classList.remove("show");
    drawerEl.setAttribute("aria-hidden", "true");
    menuToggleEl.setAttribute("aria-expanded", "false");
    // Hide the overlay after its fade-out so it stops intercepting taps.
    setTimeout(() => { drawerOverlayEl.hidden = true; }, 260);
  }

  // ---- Home screen (photo activity tiles) ----
  function categoryExists(name) {
    return buildModel().some((g) => g.category === name);
  }

  // Let the user pick an image file and store it as this tile's photo.
  function pickTilePhoto(tile) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        alert("Please choose an image file.");
        return;
      }
      setCustomPhoto(tile.key, file)
        .then(() => renderHome())
        .catch(() => alert("Sorry, that image couldn't be saved on this device."));
    });
    input.click();
  }

  // Build a home tile for each user-created category that has no built-in tile,
  // so adding a category also adds it to the home screen. These have no bundled
  // photo, so they fall back to the emoji + gradient (or a photo the user adds
  // via the 📷 button). Custom tiles alternate tall/short to keep the mosaic
  // staggered. The trailing wide banners stay last.
  function customTiles() {
    const builtInTargets = new Set(HOME_TILES.map((t) => t.target));
    return getCustomCategories()
      .filter((c) => !builtInTargets.has(c.category))
      .map((c, i) => ({
        key: "cat-" + slugify(c.category),
        label: c.category.replace(/^[^A-Za-z0-9]+/, "").trim() || c.category,
        emoji: firstEmoji(c.category) || "📌",
        target: c.category,
        tall: i % 2 === 0,
        img: DEFAULT_TILE_IMAGES[i % DEFAULT_TILE_IMAGES.length],
      }));
  }

  function renderHome() {
    // Revoke any object URLs from the previous render to avoid memory leaks.
    tilePhotoUrls.forEach((u) => URL.revokeObjectURL(u));
    tilePhotoUrls = [];
    homeTilesEl.innerHTML = "";

    // Custom-category tiles slot in before the trailing wide banners so the two
    // feature banners (Back to school, Chores) always close the mosaic.
    const trailing = HOME_TILES.filter((t) => t.wide && t.tail);
    const lead = HOME_TILES.filter((t) => !(t.wide && t.tail));
    const tiles = [...lead, ...customTiles(), ...trailing];

    tiles.forEach((t) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className =
        "home-tile" +
        (t.wide ? " home-tile-wide" : "") +
        (t.tall ? " home-tile-tall" : "");

      const overlay = document.createElement("span");
      overlay.className = "home-tile-overlay";
      const emoji = document.createElement("span");
      emoji.className = "home-tile-emoji";
      emoji.textContent = t.emoji;
      const label = document.createElement("span");
      label.className = "home-tile-label";
      label.textContent = t.label;
      overlay.append(emoji, label);

      const img = document.createElement("img");
      img.className = "home-tile-img";
      // Built-in tiles load images/<key>.jpg; custom-category tiles use a rotated
      // default photo (t.img). A user's own photo from IndexedDB overrides both.
      img.src = t.img || `images/${t.key}.jpg`;
      img.alt = t.label;
      img.loading = "lazy";
      img.decoding = "async";
      // If a tile has no photo yet (e.g. Chores until an image is added), hide the
      // broken <img> so the emoji + gradient overlay shows on its own, cleanly.
      img.addEventListener("error", () => {
        img.style.display = "none";
      });

      // Photo controls. Not real <button>s (a tile is already a <button> and
      // buttons can't nest); role="button" spans behave the same for our needs.
      const controls = document.createElement("span");
      controls.className = "home-tile-controls";

      const editBtn = document.createElement("span");
      editBtn.className = "tile-photo-btn";
      editBtn.setAttribute("role", "button");
      editBtn.setAttribute("tabindex", "0");
      editBtn.setAttribute("aria-label", "Change photo for " + t.label);
      editBtn.title = "Change photo";
      editBtn.textContent = "📷";

      const resetBtn = document.createElement("span");
      resetBtn.className = "tile-photo-btn tile-photo-reset hidden";
      resetBtn.setAttribute("role", "button");
      resetBtn.setAttribute("tabindex", "0");
      resetBtn.setAttribute("aria-label", "Reset photo for " + t.label);
      resetBtn.title = "Reset to default photo";
      resetBtn.textContent = "↺";

      controls.append(editBtn, resetBtn);

      // Stop tile navigation when interacting with the photo controls.
      const activate = (el, fn) => {
        const handler = (e) => {
          e.stopPropagation();
          e.preventDefault();
          fn();
        };
        el.addEventListener("click", handler);
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") handler(e);
        });
      };
      activate(editBtn, () => pickTilePhoto(t));
      activate(resetBtn, () => {
        clearCustomPhoto(t.key)
          .then(() => renderHome())
          .catch(() => {});
      });

      tile.append(img, overlay, controls);
      tile.addEventListener("click", () => {
        if (t.planner) {
          showPlanner();
        } else if (t.target && categoryExists(t.target)) {
          activeFilter = t.target;
          showDetail();
        }
      });
      homeTilesEl.appendChild(tile);

      // Swap in the user's custom photo (if any) once loaded from IndexedDB.
      getCustomPhoto(t.key).then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        tilePhotoUrls.push(url);
        img.style.display = "";
        img.src = url;
        img.loading = "eager";
        resetBtn.classList.remove("hidden");
      });
    });
  }

  // ---- Planner / calendar --------------------------------------------------
  // Local-date helpers that never touch UTC (avoids off-by-one day shifts).
  function ymd(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function parseYmd(iso) {
    const [y, m, dd] = String(iso).split("-").map(Number);
    return new Date(y, m - 1, dd);
  }
  function addDays(d, n) {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  }
  // Monday-based start of the week containing d.
  function startOfWeek(d) {
    const c = new Date(d);
    const day = (c.getDay() + 6) % 7; // Mon=0 … Sun=6
    return addDays(c, -day);
  }
  function sameYmd(a, b) {
    return ymd(a) === ymd(b);
  }

  // Invert the stored dates into { "YYYY-MM-DD": [{ id, name, category, color }] },
  // resolving each item's category colour from the current model.
  function buildDayIndex() {
    const model = buildModel();
    const colorByKey = {};
    const nameByKey = {};
    const catByKey = {};
    model.forEach((g) => {
      g.items.forEach((it) => {
        const nm = itemName(it);
        const k = keyFor(g.category, nm);
        colorByKey[k] = g.color;
        nameByKey[k] = nm;
        catByKey[k] = g.category;
      });
    });
    const index = {};
    const dates = getDates();
    Object.keys(dates).forEach((k) => {
      // Skip items that no longer exist in the model (deleted categories/items).
      if (!(k in nameByKey)) return;
      (dates[k] || []).forEach((iso) => {
        (index[iso] = index[iso] || []).push({
          id: k,
          name: nameByKey[k],
          category: catByKey[k],
          color: colorByKey[k] || "#a6cdf5",
        });
      });
    });
    return index;
  }

  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // ---- Weather (postcode -> forecast) --------------------------------------
  // Location is persisted; the forecast itself is fetched fresh (online-only)
  // and kept only in memory, keyed by "YYYY-MM-DD".
  let weatherByDay = {};   // { iso: { code, max, min } }
  let weatherLoading = false;

  function getWeatherLoc() {
    return loadState().weatherLoc || null; // { postcode, place, lat, lon }
  }
  function setWeatherLoc(loc) {
    if (loc) saveState({ weatherLoc: loc });
    else {
      const s = loadState();
      delete s.weatherLoc;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }
  }

  // Map a WMO weather code to a friendly emoji + short label.
  function weatherIcon(code) {
    if (code === 0) return { icon: "☀️", label: "Clear" };
    if (code === 1) return { icon: "🌤️", label: "Mainly clear" };
    if (code === 2) return { icon: "⛅", label: "Partly cloudy" };
    if (code === 3) return { icon: "☁️", label: "Overcast" };
    if (code === 45 || code === 48) return { icon: "🌫️", label: "Fog" };
    if (code >= 51 && code <= 57) return { icon: "🌦️", label: "Drizzle" };
    if (code >= 61 && code <= 67) return { icon: "🌧️", label: "Rain" };
    if (code >= 71 && code <= 77) return { icon: "🌨️", label: "Snow" };
    if (code >= 80 && code <= 82) return { icon: "🌦️", label: "Showers" };
    if (code === 85 || code === 86) return { icon: "🌨️", label: "Snow showers" };
    if (code === 95) return { icon: "⛈️", label: "Thunderstorm" };
    if (code === 96 || code === 99) return { icon: "⛈️", label: "Thunderstorm" };
    return { icon: "🌡️", label: "" };
  }

  // Codes that mean "wet" — these badges get a rainy blue tint (regardless of
  // temperature) so wet days stand out at a glance.
  function isRainyCode(code) {
    return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  }

  // Temperature band -> badge colour class (based on the day's high).
  function tempClass(max) {
    if (max > 28) return "wx-hot";      // above 28° — red
    if (max >= 25) return "wx-warm";    // 25–28° — orange
    if (max >= 20) return "wx-mild";    // 20–25° — yellow
    return "wx-cool";                   // below 20° — cool blue
  }

  function setWeatherStatus(msg, kind) {
    weatherStatusEl.textContent = msg || "";
    weatherStatusEl.classList.toggle("is-error", kind === "error");
    weatherStatusEl.classList.toggle("is-ok", kind === "ok");
  }

  // Resolve a UK postcode to coordinates + place name via postcodes.io.
  async function lookupPostcode(raw) {
    const pc = String(raw).trim().replace(/\s+/g, "");
    if (!pc) throw new Error("Please enter a postcode.");
    const res = await fetch(
      "https://api.postcodes.io/postcodes/" + encodeURIComponent(pc)
    );
    if (!res.ok) throw new Error("Postcode not found. Please check and try again.");
    const data = await res.json();
    const r = data && data.result;
    if (!r) throw new Error("Postcode not found. Please check and try again.");
    return {
      postcode: r.postcode,
      place: r.admin_district || r.parish || r.region || r.postcode,
      lat: r.latitude,
      lon: r.longitude,
    };
  }

  // Fetch a daily forecast (Open-Meteo, keyless) and index it by date.
  async function fetchForecast(lat, lon) {
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=" + lat +
      "&longitude=" + lon +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
      "&timezone=auto&forecast_days=16";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Couldn't load the forecast. Please try again.");
    const data = await res.json();
    const d = data && data.daily;
    const out = {};
    if (d && Array.isArray(d.time)) {
      d.time.forEach((iso, i) => {
        out[iso] = {
          code: d.weather_code[i],
          max: Math.round(d.temperature_2m_max[i]),
          min: Math.round(d.temperature_2m_min[i]),
        };
      });
    }
    return out;
  }

  // Load (or reload) the forecast for the saved location, then re-render.
  async function loadWeather() {
    const loc = getWeatherLoc();
    if (!loc) return;
    weatherLoading = true;
    setWeatherStatus("Loading forecast for " + loc.place + "…");
    try {
      weatherByDay = await fetchForecast(loc.lat, loc.lon);
      setWeatherStatus("Showing weather for " + loc.place + " (" + loc.postcode + ")", "ok");
    } catch (err) {
      weatherByDay = {};
      setWeatherStatus(err.message || "Couldn't load the forecast.", "error");
    } finally {
      weatherLoading = false;
      if (currentView === "planner") renderPlanner();
    }
  }

  // Handle a postcode search: resolve, persist, fetch, render.
  async function searchWeather(raw) {
    setWeatherStatus("Finding postcode…");
    try {
      const loc = await lookupPostcode(raw);
      setWeatherLoc(loc);
      weatherInputEl.value = loc.postcode;
      weatherClearBtnEl.classList.remove("hidden");
      await loadWeather();
    } catch (err) {
      setWeatherStatus(err.message || "Something went wrong.", "error");
    }
  }

  function clearWeather() {
    setWeatherLoc(null);
    weatherByDay = {};
    weatherInputEl.value = "";
    weatherClearBtnEl.classList.add("hidden");
    setWeatherStatus("");
    if (currentView === "planner") renderPlanner();
  }

  function renderPlanner() {
    $("planner-week").classList.toggle("is-active", plannerMode === "week");
    $("planner-week").setAttribute("aria-selected", String(plannerMode === "week"));
    $("planner-month").classList.toggle("is-active", plannerMode === "month");
    $("planner-month").setAttribute("aria-selected", String(plannerMode === "month"));

    const index = buildDayIndex();
    const hasAny = Object.keys(index).length > 0;
    plannerEmptyEl.classList.toggle("hidden", hasAny);

    if (plannerMode === "week") renderWeek(index);
    else renderMonth(index);
  }

  function renderWeek(index) {
    const start = startOfWeek(plannerAnchor);
    const end = addDays(start, 6);
    plannerTitleEl.textContent =
      start.getDate() + " " + MONTHS[start.getMonth()].slice(0, 3) +
      " – " + end.getDate() + " " + MONTHS[end.getMonth()].slice(0, 3);

    plannerGridEl.className = "planner-grid planner-week";
    plannerGridEl.innerHTML = "";
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      plannerGridEl.appendChild(dayCell(day, index, true));
    }
  }

  function renderMonth(index) {
    const anchor = plannerAnchor;
    plannerTitleEl.textContent = MONTHS[anchor.getMonth()] + " " + anchor.getFullYear();

    plannerGridEl.className = "planner-grid planner-month";
    plannerGridEl.innerHTML = "";
    WEEKDAYS.forEach((w) => {
      const h = document.createElement("div");
      h.className = "planner-dow";
      h.textContent = w;
      plannerGridEl.appendChild(h);
    });
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    for (let i = 0; i < 42; i++) {
      const day = addDays(gridStart, i);
      const cell = dayCell(day, index, false);
      if (day.getMonth() !== anchor.getMonth()) cell.classList.add("is-other-month");
      plannerGridEl.appendChild(cell);
    }
  }

  // One day cell. `showWeekday` labels the day with its name (week view).
  function dayCell(day, index, showWeekday) {
    const iso = ymd(day);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "planner-day";
    if (sameYmd(day, new Date())) cell.classList.add("is-today");

    const head = document.createElement("span");
    head.className = "planner-day-head";
    head.textContent = showWeekday
      ? WEEKDAYS[(day.getDay() + 6) % 7] + " " + day.getDate()
      : String(day.getDate());
    cell.appendChild(head);

    // Weather badge (only for days the forecast covers).
    const wx = weatherByDay[iso];
    if (wx) {
      const info = weatherIcon(wx.code);
      const badge = document.createElement("span");
      // Rain wins over the temperature colour; otherwise band by the high temp.
      const tone = isRainyCode(wx.code) ? "wx-rain" : tempClass(wx.max);
      badge.className = "planner-weather " + tone;
      badge.title = info.label
        ? info.label + " · " + wx.max + "° / " + wx.min + "°"
        : wx.max + "° / " + wx.min + "°";
      const ic = document.createElement("span");
      ic.className = "planner-weather-icon";
      ic.textContent = info.icon;
      const tp = document.createElement("span");
      tp.className = "planner-weather-temp";
      tp.textContent = wx.max + "° / " + wx.min + "°";
      badge.append(ic, tp);
      cell.appendChild(badge);
    }

    const items = index[iso] || [];
    const chips = document.createElement("span");
    chips.className = "planner-day-chips";
    items.slice(0, showWeekday ? 8 : 3).forEach((it) => {
      const chip = document.createElement("span");
      chip.className = "planner-chip";
      chip.style.background = "color-mix(in srgb, " + it.color + " 30%, #fff)";
      chip.style.borderColor = it.color;
      chip.textContent = it.name;
      chips.appendChild(chip);
    });
    const hidden = items.length - (showWeekday ? 8 : 3);
    if (hidden > 0) {
      const more = document.createElement("span");
      more.className = "planner-chip planner-chip-more";
      more.textContent = "+" + hidden + " more";
      chips.appendChild(more);
    }
    cell.appendChild(chips);

    if (items.length) cell.classList.add("has-items");
    cell.addEventListener("click", () => openDayPanel(day, items));
    return cell;
  }

  // The day currently shown in the panel, so the add-activity form knows which
  // date to plan the new activity on.
  let dayPanelDate = null;

  // Fill the day-panel category <select> from the current model (built-in +
  // custom), preserving the previously chosen category when possible.
  function populateDayAddCategories() {
    const prev = dayAddCategoryEl.value;
    dayAddCategoryEl.innerHTML = "";
    buildModel().forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.category;
      opt.textContent = g.category;
      dayAddCategoryEl.appendChild(opt);
    });
    if (prev) dayAddCategoryEl.value = prev;
  }

  // Fill the name box's <datalist> with the existing items of the currently
  // selected category, so the user can pick one (or still type a new one).
  function populateDayAddItems() {
    dayAddItemsEl.innerHTML = "";
    const cat = dayAddCategoryEl.value;
    const group = buildModel().find((g) => g.category === cat);
    if (!group) return;
    group.items.forEach((it) => {
      const opt = document.createElement("option");
      opt.value = itemName(it);
      dayAddItemsEl.appendChild(opt);
    });
  }

  // Add an activity (creating it in its category if new) and plan it on `iso`.
  // Unlike addItem(), this also dates an already-existing item and does not
  // re-render the detail view.
  function addActivityOnDay(category, rawName, iso) {
    const name = (rawName || "").trim();
    if (!name) return { ok: false, msg: "Please type an activity name." };
    if (!category) return { ok: false, msg: "Please choose a category." };

    const model = buildModel();
    const group = model.find((g) => g.category === category);
    const exists = group && group.items.some((it) => itemName(it) === name);

    if (!exists) {
      const customItems = getCustomItems();
      const list = customItems[category] ? customItems[category].slice() : [];
      list.push(name);
      customItems[category] = list;
      const removed = getRemoved();
      delete removed[keyFor(category, name)];
      saveState({ customItems, removed });
    }

    const id = keyFor(category, name);
    const dates = getItemDates(id);
    const already = dates.includes(iso);
    if (!already) setItemDates(id, dates.concat(iso));
    return {
      ok: true,
      already,
      msg: already
        ? "\u201c" + name + "\u201d is already on this day."
        : "Added \u201c" + name + "\u201d.",
    };
  }

  function openDayPanel(day, items) {
    dayPanelDate = day;
    dayPanelTitleEl.textContent = parseYmd(ymd(day)).toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long",
    });
    populateDayAddCategories();
    populateDayAddItems();
    dayAddMsgEl.textContent = "";
    dayPanelListEl.innerHTML = "";
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "day-panel-empty";
      li.textContent = "Nothing planned for this day.";
      dayPanelListEl.appendChild(li);
    } else {
      const iso = ymd(day);
      items.forEach((it) => {
        const li = document.createElement("li");
        li.className = "day-panel-item";
        const dot = document.createElement("span");
        dot.className = "day-panel-dot";
        dot.style.background = it.color;
        const txt = document.createElement("span");
        txt.className = "day-panel-item-text";
        txt.textContent = it.name;
        const cat = document.createElement("span");
        cat.className = "day-panel-item-cat";
        cat.textContent = it.category;
        const meta = document.createElement("span");
        meta.className = "day-panel-item-meta";
        meta.append(txt, cat);
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "day-panel-remove";
        rm.textContent = "Remove";
        rm.setAttribute("aria-label", "Remove " + it.name + " from this day");
        rm.addEventListener("click", () => {
          setItemDates(it.id, getItemDates(it.id).filter((d) => d !== iso));
          // Re-render both the panel and the grid so counts stay in sync.
          const fresh = buildDayIndex()[iso] || [];
          openDayPanel(day, fresh);
          renderPlanner();
        });
        li.append(dot, meta, rm);
        dayPanelListEl.appendChild(li);
      });
    }
    dayPanelEl.classList.remove("hidden");
    dayPanelEl.setAttribute("aria-hidden", "false");
    dayPanelOverlayEl.classList.remove("hidden");
  }

  function closeDayPanel() {
    dayPanelEl.classList.add("hidden");
    dayPanelEl.setAttribute("aria-hidden", "true");
    dayPanelOverlayEl.classList.add("hidden");
  }

  // Move the visible range by one week or month.
  function shiftPlanner(dir) {
    if (plannerMode === "week") {
      plannerAnchor = addDays(plannerAnchor, dir * 7);
    } else {
      plannerAnchor = new Date(
        plannerAnchor.getFullYear(), plannerAnchor.getMonth() + dir, 1
      );
    }
    renderPlanner();
  }

  function showHome() {
    currentView = "home";
    homeEl.classList.remove("hidden");
    detailEl.classList.add("hidden");
    plannerEl.classList.add("hidden");
    renderHome();
    renderDrawer(buildModel(), loadState().ticks || {});
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function showDetail() {
    currentView = "detail";
    homeEl.classList.add("hidden");
    detailEl.classList.remove("hidden");
    plannerEl.classList.add("hidden");
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function showPlanner() {
    currentView = "planner";
    homeEl.classList.add("hidden");
    detailEl.classList.add("hidden");
    plannerEl.classList.remove("hidden");
    // Restore a saved postcode and refresh its forecast on open.
    const loc = getWeatherLoc();
    if (loc) {
      weatherInputEl.value = loc.postcode;
      weatherClearBtnEl.classList.remove("hidden");
      if (!weatherLoading) loadWeather();
    }
    renderPlanner();
    renderDrawer(buildModel(), loadState().ticks || {});
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // Should this group show under the current filter?
  function groupVisible(group) {
    if (activeFilter === "all") return true;
    return group.category === activeFilter;
  }

  function render() {
    const ticks = loadState().ticks || {};
    const model = buildModel();
    renderDrawer(model, ticks);
    checklistEl.innerHTML = "";

    model.filter(groupVisible).forEach((group) => {
      const section = document.createElement("div");
      section.className = "checklist-group";
      if (group.daily) section.classList.add("is-daily");
      if (group.color) section.style.setProperty("--accent", group.color);
      // In the combined "all" view, start each category collapsed so the single
      // column stays a compact, scannable list. Filtering to one category (via a
      // tile or sidebar link) shows it expanded.
      if (activeFilter === "all") {
        section.classList.add("collapsed");
      }

      const paid = isPaid(group);
      if (paid) section.dataset.paid = "1";

      const h = document.createElement("button");
      h.className = "group-head";
      h.innerHTML =
        '<span class="sec-title"></span>' +
        '<span class="sec-meta"><span class="sec-count"></span>' +
        '<span class="sec-bar"><span class="sec-bar-fill"></span></span>' +
        '<span class="sec-caret">▸</span></span>';
      h.querySelector(".sec-title").textContent = group.category;
      // Paid categories show a running "earned" badge in the section header.
      if (paid) {
        const earnedEl = document.createElement("span");
        earnedEl.className = "sec-earned";
        earnedEl.textContent = formatMoney(0);
        h.querySelector(".sec-meta").prepend(earnedEl);
      }
      // Only user-created categories can be deleted; built-ins have no control.
      if (group.custom) {
        const catDel = document.createElement("span");
        catDel.className = "sec-del";
        catDel.setAttribute("role", "button");
        catDel.setAttribute("tabindex", "0");
        catDel.textContent = "🗑";
        catDel.title = "Delete category";
        catDel.setAttribute("aria-label", "Delete category " + group.category);
        const doDelete = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (
            window.confirm(
              'Delete the "' +
                group.category +
                '" category and everything in it? This can\u2019t be undone.'
            )
          ) {
            deleteCategory(group.category);
          }
        };
        catDel.addEventListener("click", doDelete);
        catDel.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") doDelete(e);
        });
        h.querySelector(".sec-meta").prepend(catDel);
      }
      h.addEventListener("click", () => section.classList.toggle("collapsed"));
      section.appendChild(h);

      const rows = document.createElement("div");
      rows.className = "group-rows";
      section.appendChild(rows);

      group.items.forEach((item) => {
        const name = itemName(item);
        const reward = itemReward(item);
        const id = keyFor(group.category, name);
        const row = document.createElement("label");
        row.className = "check-row";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = !!ticks[id];
        if (paid) box.dataset.reward = reward;
        box.addEventListener("change", () => {
          const t = loadState().ticks || {};
          t[id] = box.checked;
          saveState({ ticks: t });
          // Bank money: ticking a paid chore adds its reward to the running
          // total, unticking (a same-day correction) takes it back off. The bank
          // is kept even when daily chores reset each morning, so it only ever
          // changes here — never during a reset. Clamp at 0 for safety.
          if (paid && reward > 0) {
            const cur = Number(loadState().earnedTotal) || 0;
            const next = Math.max(0, cur + (box.checked ? reward : -reward));
            saveState({ earnedTotal: next });
          }
          row.classList.toggle("done", box.checked);
          updateSection(section);
          updateProgress();
        });
        if (box.checked) row.classList.add("done");
        const text = document.createElement("span");
        text.className = "check-text";
        text.textContent = name;

        const dateControl = buildDateControl(id, name);

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

        if (paid) {
          const badge = document.createElement("span");
          badge.className = "reward-badge";
          badge.textContent = formatMoney(reward);
          row.append(box, text, badge, dateControl, del);
        } else {
          row.append(box, text, dateControl, del);
        }
        rows.appendChild(row);
      });

      rows.appendChild(buildAddItemRow(group));

      checklistEl.appendChild(section);
      updateSection(section);
    });

    checklistEl.appendChild(buildAddCategoryControl());

    updateProgress();
  }

  // Close every open date popover (used for outside-click / Escape dismissal).
  function closeAllDatePopovers() {
    document
      .querySelectorAll(".row-date-pop:not(.hidden)")
      .forEach((p) => p.classList.add("hidden"));
    document
      .querySelectorAll('.row-date[aria-expanded="true"]')
      .forEach((b) => b.setAttribute("aria-expanded", "false"));
  }

  // Register once: dismiss any open date popover on an outside click or Escape,
  // so the user can close it without having to pick a date.
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest(".row-date-wrap")) {
      closeAllDatePopovers();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllDatePopovers();
  });

  // Build the 📅 date control for one item row: a toggle button showing how many
  // days are planned, plus an inline popover to add/remove dates. State is stored
  // via setItemDates(id, …). The row is a <label>, so every interactive element
  // here stops propagation + prevents default to avoid toggling the checkbox.
  function buildDateControl(id, name) {
    const wrap = document.createElement("span");
    wrap.className = "row-date-wrap";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row-date";
    btn.setAttribute("aria-label", "Plan dates for " + name);
    btn.setAttribute("aria-expanded", "false");

    const count = document.createElement("span");
    count.className = "row-date-count";

    const pop = document.createElement("span");
    pop.className = "row-date-pop hidden";

    const refreshCount = () => {
      const n = getItemDates(id).length;
      btn.textContent = "📅";
      btn.classList.toggle("has-dates", n > 0);
      count.textContent = n ? String(n) : "";
      count.classList.toggle("hidden", n === 0);
    };

    const renderChips = () => {
      pop.innerHTML = "";

      const dates = getItemDates(id);

      // Native date picker: choosing a date assigns it immediately and closes the
      // popover — no separate "add" button. Prepopulated with the latest date so
      // reopening shows what's planned.
      const input = document.createElement("input");
      input.type = "date";
      input.className = "row-date-input";
      input.setAttribute("aria-label", "Pick a date for " + name);
      if (dates.length) input.value = dates[dates.length - 1];
      input.addEventListener("change", (e) => {
        e.stopPropagation();
        const val = input.value;
        if (!val) return;
        setItemDates(id, getItemDates(id).concat(val));
        refreshCount();
        // Assign-and-close: the count badge shows the result; reopening rebuilds
        // the chip list.
        closePop();
      });

      const list = document.createElement("span");
      list.className = "row-date-chips";
      if (!dates.length) {
        const empty = document.createElement("span");
        empty.className = "row-date-empty";
        empty.textContent = "No dates planned yet.";
        list.appendChild(empty);
      } else {
        dates.forEach((iso) => {
          const chip = document.createElement("span");
          chip.className = "row-date-chip";
          const lbl = document.createElement("span");
          lbl.textContent = formatDateLabel(iso);
          const rm = document.createElement("button");
          rm.type = "button";
          rm.className = "row-date-chip-del";
          rm.textContent = "✕";
          rm.setAttribute("aria-label", "Remove " + formatDateLabel(iso));
          rm.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            setItemDates(id, getItemDates(id).filter((d) => d !== iso));
            refreshCount();
            renderChips();
          });
          chip.append(lbl, rm);
          list.appendChild(chip);
        });
      }

      pop.append(input, list);
    };

    const closePop = () => {
      pop.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    };

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = pop.classList.contains("hidden");
      // Close any other open date popovers first (and this one, so toggling shut works).
      closeAllDatePopovers();
      if (willOpen) {
        renderChips();
        pop.classList.remove("hidden");
        btn.setAttribute("aria-expanded", "true");
      }
    });
    // Clicks inside the popover shouldn't toggle the row checkbox.
    pop.addEventListener("click", (e) => e.stopPropagation());

    refreshCount();
    wrap.append(btn, count, pop);
    return wrap;
  }

  // A row at the bottom of each section for typing a new item into that category.
  // Paid (chores) categories also get a small "£" amount input so new chores can
  // carry a reward.
  function buildAddItemRow(group) {
    const category = group.category;
    const paid = isPaid(group);
    const wrap = document.createElement("form");
    wrap.className = "add-item-row";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "add-item-input";
    input.placeholder = "Add an item…";
    input.maxLength = 80;

    let amount = null;
    if (paid) {
      amount = document.createElement("input");
      amount.type = "number";
      amount.className = "add-item-amount";
      amount.inputMode = "decimal";
      amount.min = "0";
      amount.step = "0.5";
      amount.placeholder = "£";
      amount.setAttribute("aria-label", "Reward amount for new chore");
    }

    const add = document.createElement("button");
    add.type = "submit";
    add.className = "add-item-btn";
    add.textContent = "＋";
    add.setAttribute("aria-label", "Add item to " + category);
    wrap.addEventListener("submit", (e) => {
      e.preventDefault();
      addItem(category, input.value, paid ? amount.value : undefined);
      input.value = "";
      if (amount) amount.value = "";
    });
    if (paid) wrap.append(input, amount, add);
    else wrap.append(input, add);
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
  // `rawReward` is only passed for paid (chores) categories; when present the
  // stored entry becomes an object { name, reward } instead of a plain string.
  function addItem(category, rawName, rawReward) {
    const name = (rawName || "").trim();
    if (!name) return;
    const model = buildModel();
    const group = model.find((g) => g.category === category);
    // No duplicates in view (compare by name so object items match too).
    if (group && group.items.some((it) => itemName(it) === name)) return;

    const hasReward = rawReward != null && String(rawReward).trim() !== "";
    const reward = hasReward ? Math.max(0, Number(rawReward) || 0) : 0;
    const entry = hasReward ? { name, reward } : name;

    const customItems = getCustomItems();
    const list = customItems[category] ? customItems[category].slice() : [];
    if (!list.some((it) => itemName(it) === name)) list.push(entry);
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

  // Remove a user-created category entirely: the category itself, any items added
  // to it, and any leftover removed/tick bookkeeping keyed to it. Only custom
  // categories can be deleted — built-ins have no delete control. The tile's
  // uploaded photo (IndexedDB) is cleared too so nothing lingers on the device.
  function deleteCategory(name) {
    const cats = getCustomCategories().filter((c) => c.category !== name);

    // Drop items the user added to this category.
    const customItems = getCustomItems();
    delete customItems[name];

    // Clear any removed-item and tick bookkeeping scoped to this category.
    const prefix = name + "|";
    const removed = getRemoved();
    Object.keys(removed).forEach((k) => {
      if (k.indexOf(prefix) === 0) delete removed[k];
    });
    const ticks = loadState().ticks || {};
    Object.keys(ticks).forEach((k) => {
      if (k.indexOf(prefix) === 0) delete ticks[k];
    });

    saveState({ customCategories: cats, customItems, removed, ticks });

    // Remove any user-uploaded photo for this category's home tile.
    clearCustomPhoto("cat-" + slugify(name)).catch(() => {});

    // If we were viewing/filtered to the now-deleted category, fall back home.
    if (activeFilter === name) {
      activeFilter = "all";
      showHome();
      return;
    }
    render();
  }

  function deleteItem(category, name) {
    // Drop from custom items if present…
    const customItems = getCustomItems();
    if (customItems[category]) {
      customItems[category] = customItems[category].filter(
        (it) => itemName(it) !== name
      );
      if (customItems[category].length === 0) delete customItems[category];
    }
    // …and always record it as removed so a built-in also disappears.
    const removed = getRemoved();
    removed[keyFor(category, name)] = true;
    // Clear any tick so progress stays accurate.
    const ticks = loadState().ticks || {};
    delete ticks[keyFor(category, name)];
    // Drop any planned dates for the item too.
    const dates = getDates();
    delete dates[keyFor(category, name)];

    saveState({ customItems, removed, ticks, dates });
    render();
  }

  // Lightweight confetti burst (no library). Draws to the full-screen canvas.
  function burstConfetti() {
    // Respect users who prefer reduced motion — skip the animation entirely.
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
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

  // Clear the daily ticks from a ticks object (shared by manual + auto reset).
  // This covers both the whole "Daily basics" category (g.daily) and individual
  // daily chores (item.daily) so recurring chores re-open each morning. It only
  // touches ticks — the banked earnedTotal is deliberately left untouched so the
  // money the child earned is kept across the reset.
  function clearDailyTicks(ticks) {
    buildModel().forEach((g) => {
      g.items.forEach((it) => {
        const daily = g.daily || (typeof it === "object" && it && it.daily);
        if (daily) delete ticks[keyFor(g.category, itemName(it))];
      });
    });
    return ticks;
  }

  // Clear only the daily-basics ticks (fresh start each day).
  function resetDaily() {
    const ticks = clearDailyTicks(loadState().ticks || {});
    saveState({ ticks, lastDailyReset: todayStamp() });
    render();
  }

  // Local calendar day as YYYY-MM-DD (used to detect a new morning).
  function todayStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // Short, friendly label for a "YYYY-MM-DD" day, e.g. "Sat 2 Aug".
  function formatDateLabel(iso) {
    const parts = String(iso).split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return iso;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  // On the first open of a new day, automatically clear the daily-basics ticks so
  // the routine starts fresh each morning. Runs once at startup before any render.
  function maybeAutoResetDaily() {
    const state = loadState();
    const today = todayStamp();
    if (state.lastDailyReset === today) return;
    const ticks = clearDailyTicks(state.ticks || {});
    saveState({ ticks, lastDailyReset: today });
  }

  // ---- Backup: export/import all user content as a JSON file ----
  // Covers everything in localStorage (ticks, custom items/categories, removals).
  // Custom tile photos live in IndexedDB and stay device-local, so they are not
  // part of the JSON backup.
  function exportData() {
    const state = loadState();
    const payload = {
      app: "summer-checklist",
      version: 1,
      exportedAt: new Date().toISOString(),
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "summer-checklist-backup-" + todayStamp() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importData() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          const state = parsed && parsed.state ? parsed.state : parsed;
          if (!state || typeof state !== "object") {
            throw new Error("bad shape");
          }
          if (
            !confirm(
              "Import this backup? It will replace your current items and progress on this device."
            )
          ) {
            return;
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          if (currentView === "detail") render();
          else showHome();
          alert("Backup imported.");
        } catch (_) {
          alert("Sorry, that doesn't look like a valid Summer Checklist backup.");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  $("reset-daily").addEventListener("click", resetDaily);
  $("reset-all").addEventListener("click", () => {
    if (
      !confirm(
        "Uncheck everything? This clears all your ticked items and resets your banked chore money to £0."
      )
    )
      return;
    saveState({ ticks: {}, earnedTotal: 0 });
    render();
  });
  $("export-data").addEventListener("click", exportData);
  $("import-data").addEventListener("click", importData);

  // ---- Offline indicator ----
  const offlineBadge = $("offline-badge");
  function updateOnlineStatus() {
    if (offlineBadge) offlineBadge.hidden = navigator.onLine;
  }
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();

  // Drawer open/close wiring.
  menuToggleEl.addEventListener("click", openDrawer);
  $("drawer-close").addEventListener("click", closeDrawer);
  drawerOverlayEl.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawerEl.classList.contains("open")) closeDrawer();
  });

  // Back button on the detail view returns to the home tiles.
  $("back-home").addEventListener("click", showHome);

  // ---- Planner controls ----
  $("planner-back").addEventListener("click", showHome);
  $("planner-prev").addEventListener("click", () => shiftPlanner(-1));
  $("planner-next").addEventListener("click", () => shiftPlanner(1));
  $("planner-today").addEventListener("click", () => {
    plannerAnchor = new Date();
    renderPlanner();
  });
  $("planner-week").addEventListener("click", () => {
    plannerMode = "week";
    renderPlanner();
  });
  $("planner-month").addEventListener("click", () => {
    plannerMode = "month";
    renderPlanner();
  });
  $("day-panel-close").addEventListener("click", closeDayPanel);
  dayPanelOverlayEl.addEventListener("click", closeDayPanel);

  // Add an activity to the day currently shown in the panel.
  // Switching category clears any leftover item picked from the old category
  // and refreshes the suggestion list to the new category's items.
  dayAddCategoryEl.addEventListener("change", () => {
    dayAddNameEl.value = "";
    dayAddMsgEl.textContent = "";
    dayAddMsgEl.classList.remove("is-error");
    populateDayAddItems();
  });
  dayAddFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!dayPanelDate) return;
    const iso = ymd(dayPanelDate);
    const res = addActivityOnDay(dayAddCategoryEl.value, dayAddNameEl.value, iso);
    dayAddMsgEl.textContent = res.msg || "";
    dayAddMsgEl.classList.toggle("is-error", !res.ok);
    if (res.ok && !res.already) {
      dayAddNameEl.value = "";
      // Refresh the panel list and the calendar so the new chip shows at once.
      openDayPanel(dayPanelDate, buildDayIndex()[iso] || []);
      dayAddMsgEl.textContent = res.msg;
      renderPlanner();
    }
    dayAddNameEl.focus();
  });

  // Weather postcode search (Enter or Search button both submit the form).
  weatherFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    searchWeather(weatherInputEl.value);
  });
  weatherClearBtnEl.addEventListener("click", clearWeather);

  // Clear yesterday's daily basics on the first open of a new day, then start on
  // the summery home screen.
  maybeAutoResetDaily();
  showHome();
})();
