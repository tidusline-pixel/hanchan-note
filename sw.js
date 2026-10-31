// 一度開けば電波がなくても動くように、画面のファイルを端末に取っておく。
// 画面を直して出すときは V の数字を上げる
const V = "hanchan-v16";
const FILES = ["./", "index.html", "core.js", "frame.html", "privacy.html", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];
const CHART = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    // ブラウザの手元の写しは10分残るので、古い画面を新しい版として取り込まないよう必ずネットから取る
    await c.addAll(FILES.map(u => new Request(u, { cache: "reload" })));
    // 別のサイトの中身は読めない形で返るので add は失敗する。fetch して put する
    try { await c.put(CHART, await fetch(new Request(CHART, { mode: "no-cors" }))); } catch (err) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin && url.hostname !== "cdnjs.cloudflare.com") return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.ok || res.type === "opaque") { const c = await caches.open(V); c.put(e.request, res.clone()); }
    return res;
  })());
});
