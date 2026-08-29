import fs from "node:fs";
import path from "node:path";

// The real Next app lives in prototype/. We build it there, then lift its output
// up to the repo root because that is where Vercel's Next.js builder looks when
// it collects `.vercel/output` after our build command finishes.
//
// The output step re-resolves every traced file relative to the repo root
// (/vercel/path0/node_modules/...). Those modules were installed into
// prototype/node_modules, so without this the deploy dies at "Deploying
// outputs..." with e.g.
//   ENOENT: ... '/vercel/path0/node_modules/@img/sharp-linux-x64/index.cjs'
// Moving prototype/node_modules to the root keeps `.next` and `node_modules`
// siblings, exactly as the trace files (built with outputFileTracingRoot set to
// prototype/) expect.

const root = process.cwd();

function replaceDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.rmSync(to, { recursive: true, force: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    // Different filesystems - fall back to a symlink-preserving copy.
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// 1. Root node_modules must be the superset prototype built against.
replaceDir(path.join(root, "prototype", "node_modules"), path.join(root, "node_modules"));

// 2. Lift the build output.
replaceDir(path.join(root, "prototype", ".next"), path.join(root, ".next"));

// 3. Some Vercel Next versions expect this alias to exist.
const routesManifest = path.join(root, ".next", "routes-manifest.json");
const deterministic = path.join(root, ".next", "routes-manifest-deterministic.json");
if (fs.existsSync(routesManifest) && !fs.existsSync(deterministic)) {
  fs.copyFileSync(routesManifest, deterministic);
}

// 4. Next's build refuses to start without a .env file on disk.
const dotenv = path.join(root, ".env");
if (!fs.existsSync(dotenv)) fs.writeFileSync(dotenv, "");

// 5. Serve prototype/public from the root.
replaceDir(path.join(root, "prototype", "public"), path.join(root, "public"));

console.log("vercel-postbuild: lifted prototype output to repo root");
