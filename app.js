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

  let activeFilter = "all"; // "all" | a category name
  let currentView = "home"; // "home" | "detail"
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
  // Daily basics leads as a hero banner and Back to school closes as one; every
  // other category (Chores included) sits in the staggered 2-column mosaic,
  // alternating tall/short so the seams offset.
  const HOME_TILES = [
    { key: "daily",        label: "Daily basics",     emoji: "🎯", target: "🎯 Daily basics", wide: true },
    { key: "chores",       label: "Chores",           emoji: "💰", target: "💰 Chores", tall: true },
    { key: "activities",   label: "Days out",         emoji: "🗓️", target: "🗓️ Activities & days out" },
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
      const isActive = !d.home && currentView === "detail" && activeFilter === d.key;
      btn.className = "drawer-link" + (isActive ? " active" : "");
      if (d.color) btn.style.setProperty("--accent", d.color);

      const dot = document.createElement("span");
      dot.className = "drawer-dot";
      if (d.color) dot.style.background = d.color;
      if (d.home) dot.style.background = "transparent";

      const label = document.createElement("span");
      label.className = "drawer-label";
      label.textContent = d.label;

      const count = document.createElement("span");
      count.className = "drawer-count";
      if (!d.home) count.textContent = d.count ? d.count : "✓";

      btn.append(dot, label, count);
      btn.addEventListener("click", () => {
        closeDrawer();
        if (d.home) {
          showHome();
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
        if (t.target && categoryExists(t.target)) {
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

  function showHome() {
    currentView = "home";
    homeEl.classList.remove("hidden");
    detailEl.classList.add("hidden");
    renderHome();
    renderDrawer(buildModel(), loadState().ticks || {});
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function showDetail() {
    currentView = "detail";
    homeEl.classList.add("hidden");
    detailEl.classList.remove("hidden");
    render();
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
          row.append(box, text, badge, del);
        } else {
          row.append(box, text, del);
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

    saveState({ customItems, removed, ticks });
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

  // Clear yesterday's daily basics on the first open of a new day, then start on
  // the summery home screen.
  maybeAutoResetDaily();
  showHome();
})();
