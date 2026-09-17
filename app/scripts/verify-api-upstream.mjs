import { apiUpstream } from "../api-upstream.ts";

function run(name, env, fn) {
  const saved = { ...process.env };
  for (const key of ["VERCEL", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "API_UPSTREAM", "NEXT_PUBLIC_API_URL", "NETLIFY"]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    console.error(`fail ${name}: ${err.message}`);
    process.exitCode = 1;
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
}

run("broken vercel (no API_UPSTREAM) throws", {
  VERCEL: "1",
  VERCEL_PROJECT_PRODUCTION_URL: "csimap.vercel.app",
  NEXT_PUBLIC_API_URL: "https://csimap.vercel.app",
}, () => {
  try {
    apiUpstream();
    throw new Error("expected a throw");
  } catch (err) {
    if (!/API_UPSTREAM/.test(err.message) || err.message === "expected a throw") throw err;
  }
});

run("fixed vercel rewrites to the Go API", {
  VERCEL: "1",
  VERCEL_PROJECT_PRODUCTION_URL: "csimap.vercel.app",
  NEXT_PUBLIC_API_URL: "https://csimap.vercel.app",
  API_UPSTREAM: "https://college-maps.vercel.app",
}, () => {
  const got = apiUpstream();
  if (got !== "https://college-maps.vercel.app") throw new Error(`got ${got}`);
});

run("API_UPSTREAM cannot be this site", {
  VERCEL: "1",
  VERCEL_PROJECT_PRODUCTION_URL: "csimap.vercel.app",
  API_UPSTREAM: "https://csimap.vercel.app",
}, () => {
  try {
    apiUpstream();
    throw new Error("expected a throw");
  } catch (err) {
    if (!/itself forever/.test(err.message)) throw err;
  }
});

run("local http has no rewrite", {
  NEXT_PUBLIC_API_URL: "http://localhost:8080",
}, () => {
  const got = apiUpstream();
  if (got !== null) throw new Error(`got ${got}`);
});
