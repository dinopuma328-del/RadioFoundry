// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
//
// Fork only: the web flasher's build API for this fork, as a Cloudflare Worker. It answers the calls the flasher makes to
// the project's build service (POST /v1/builds, GET /v1/builds/<id>, and the manifest and image it points to) by running
// .github/workflows/build-on-demand.yml and serving the pre-release that workflow makes. Setup: .github/fork-build/README.md.
//
// Secret (Worker > Settings > Variables and Secrets): GH_TOKEN, a fine-grained GitHub token for this repository only,
// with Actions: read and write, Contents: read.

const REPO = "dinopuma328-del/RadioFoundry";
const ORIGIN = "https://dinopuma328-del.github.io";	// the flasher's site
const WORKFLOW = "build-on-demand.yml";
const BRANCH = "main";
const MAX_RUNNING = 3;	// builds queued or running at once: more are refused

const CORS = {
	"Access-Control-Allow-Origin": ORIGIN,
	"Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
};

const json = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (status, detail) => json({ detail }, status);

async function gh(env, path, init = {}) {
	return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
		...init,
		headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "rfoundry-fork-build",
			"X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) },
	});
}

const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => (b % 36).toString(36)).join("") + Date.now().toString(36);

// The workflow's run for a request: its run-name is "build <id>"
async function runOf(env, id) {
	const r = await gh(env, `actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=50`);
	if (!r.ok) throw new Error(`GitHub: HTTP ${r.status}`);
	const j = await r.json();
	return (j.workflow_runs || []).find((x) => x.display_title === `build ${id}`) || null;
}

async function startBuild(env, req) {
	const body = await req.json().catch(() => null);
	if (!body || typeof body.board !== "string" || !Array.isArray(body.features)) return fail(400, "bad request");
	if (!/^[a-z0-9_-]{1,40}$/.test(body.board)) return fail(400, "bad board");
	if (body.features.length > 300 || !body.features.every((f) => typeof f === "string" && /^[A-Z0-9_]{1,40}$/.test(f)))
		return fail(400, "bad features");
	const busy = await gh(env, `actions/workflows/${WORKFLOW}/runs?status=in_progress&per_page=20`).then((r) => r.json());
	const queued = await gh(env, `actions/workflows/${WORKFLOW}/runs?status=queued&per_page=20`).then((r) => r.json());
	const n = (busy.total_count || 0) + (queued.total_count || 0);
	if (n >= MAX_RUNNING) return fail(429, "the build service is busy, try again in a few minutes");
	const id = newId();
	const r = await gh(env, `actions/workflows/${WORKFLOW}/dispatches`, {
		method: "POST", headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ref: BRANCH, inputs: { board: body.board, features: [...new Set(body.features)].sort().join(","), id } }),
	});
	if (r.status !== 204) return fail(502, `could not start the build (GitHub HTTP ${r.status})`);
	return json({ id, status: "queued", position: n + 1 });
}

async function buildStatus(env, id) {
	if (!/^[a-z0-9]{6,32}$/.test(id)) return fail(404, "unknown build");
	const run = await runOf(env, id);
	if (!run) return json({ id, status: "queued" });	// just dispatched: GitHub lists the run a moment later
	if (run.status !== "completed") return json({ id, status: run.status === "in_progress" ? "running" : "queued" });
	if (run.conclusion !== "success") return json({ id, status: "failed", error: `the build failed: ${run.html_url}` });
	return json({ id, status: "done", manifest: `builds/${id}/manifest`, image: `builds/${id}/image` });
}

// A file of the build's pre-release, passed through (GitHub's download address has no CORS headers)
async function buildFile(env, id, kind) {
	if (!/^[a-z0-9]{6,32}$/.test(id)) return fail(404, "unknown build");
	const rel = await gh(env, `releases/tags/build-${id}`);
	if (!rel.ok) return fail(404, "unknown build");
	const asset = ((await rel.json()).assets || []).find((a) => a.name.endsWith(kind === "manifest" ? ".json" : ".bin"));
	if (!asset) return fail(404, "no such file");
	const f = await gh(env, `releases/assets/${asset.id}`, { headers: { Accept: "application/octet-stream" }, redirect: "follow" });
	if (!f.ok) return fail(502, `GitHub: HTTP ${f.status}`);
	return new Response(f.body, { headers: { ...CORS, "Content-Type": kind === "manifest" ? "application/json" : "application/octet-stream" } });
}

export default {
	async fetch(req, env) {
		if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
		const u = new URL(req.url), p = u.pathname.replace(/^\/v1\//, "/");
		try {
			if (req.method === "POST" && p === "/builds") return await startBuild(env, req);
			let m;
			if (req.method === "GET" && (m = p.match(/^\/builds\/([^/]+)$/))) return await buildStatus(env, m[1]);
			if (req.method === "GET" && (m = p.match(/^\/builds\/([^/]+)\/(manifest|image)$/))) return await buildFile(env, m[1], m[2]);
			// the flasher's usage reports go to the project's service: not kept here
			if (/^\/(flashes|samples|reports)/.test(p) && req.method !== "GET") return json({});
			return fail(404, "not found");
		} catch (e) {
			return fail(502, String(e && e.message || e));
		}
	},
};
