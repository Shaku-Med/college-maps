// Tells Bing and the other IndexNow engines about every page in the live sitemap, so they crawl it now
// instead of whenever they next get around to it. Run after a deploy that adds or changes pages.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR, readCampus } from "./lib/campus.mjs";

// Public by design: the engines fetch /<key>.txt from the site to prove the request came from its owner.
const KEY = "8c6ed998a9bb19673fb9e0316c8ec669";

const site = readCampus().app?.url;
if (!site || !/^https:\/\/[a-z0-9.-]+$/i.test(site)) throw new Error("campus.json app.url must be the https origin of the site");
if (!existsSync(join(APP_DIR, "public", `${KEY}.txt`))) throw new Error(`public/${KEY}.txt is missing`);

const keyLocation = `${site}/${KEY}.txt`;
const served = await fetch(keyLocation).then((res) => (res.ok ? res.text() : ""));
if (served.trim() !== KEY) throw new Error(`${keyLocation} is not live yet. Deploy first, then run this again.`);

const sitemap = await fetch(`${site}/sitemap.xml`).then((res) => {
  if (!res.ok) throw new Error(`sitemap.xml returned ${res.status}`);
  return res.text();
});
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]).filter((url) => url.startsWith(`${site}/`));
if (urls.length === 0) throw new Error("sitemap.xml has no pages on this site");

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(site).host, key: KEY, keyLocation, urlList: urls }),
});
// 200 means accepted, 202 means accepted while the key is still being checked.
if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow returned ${res.status}: ${await res.text()}`);
console.log(`Sent ${urls.length} pages to IndexNow (${res.status}).`);
