// Bump only when you want to force-drop ALL old caches. Day-to-day you no longer
// need to touch this: app code (HTML/CSS/JS) is fetched network-first, so new
// deploys show up on the next online load automatically.
const CACHE = "summer-v25";

// Static assets that rarely change — safe to serve cache-first.
const STATIC_ASSETS = [
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./images/daily.jpg",
  "./images/activities.jpg",
  "./images/rainy.jpg",
  "./images/daybag.jpg",
  "./images/learning.jpg",
  "./images/backtoschool.jpg",
  "./images/chores.jpg",
  "./images/planner.jpg",
  "./images/defaults/art.jpg",
  "./images/defaults/cooking.jpg",
  "./images/defaults/friends.jpg",
  "./images/defaults/play.jpg",
  "./images/defaults/children.jpg",
  "./images/defaults/sprinkles.jpg",
];

// App shell / code — precached so the app works offline, but served
// network-first when online so the latest version always wins.
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./checklist-data.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([...STATIC_ASSETS, ...APP_SHELL]))
  );
  self.skipWaiting();
});

// Let the page tell a waiting worker to activate immediately.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Is this a request for app code we want to keep fresh?
function isAppCode(request) {
  if (request.mode === "navigate") return true; // HTML navigations
  const dest = request.destination;
  return dest === "script" || dest === "style" || dest === "document";
}

// Network-first: try the network, fall back to cache when offline. Successful
// responses refresh the cache so the offline copy stays current.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (_) {
    const cached = await cache.match(request);
    return cached || cache.match("./index.html");
  }
}

// Cache-first: for static assets that don't change between deploys.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  const cache = await caches.open(CACHE);
  if (fresh && fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // Let Vercel Web Analytics talk to the network directly — never cache or serve
  // its script/beacons from the SW (analytics is online-only by nature).
  if (new URL(request.url).pathname.startsWith("/_vercel/")) return;
  // Weather APIs are online-only — let them hit the network directly, never
  // caching or serving stale forecasts from the SW.
  const host = new URL(request.url).hostname;
  if (host === "api.postcodes.io" || host === "api.open-meteo.com") return;
  if (isAppCode(request)) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});
