#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const src = path.resolve('prototype', '.next');
const dest = path.resolve('.next');

async function copyDir(srcDir, destDir) {
  await fs.promises.mkdir(destDir, { recursive: true });
  const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(srcDir, e.name);
    const d = path.join(destDir, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else {
      await fs.promises.copyFile(s, d);
    }
  }
}

async function main() {
  if (!fs.existsSync(src)) {
    console.error('Source .next not found at', src);
    process.exit(1);
  }

  try {
    // remove existing dest if present
    await fs.promises.rm(dest, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }

  // Prefer fs.cp when available (node 16.7+)
  if (fs.promises.cp) {
    await fs.promises.cp(src, dest, { recursive: true });
  } else {
    await copyDir(src, dest);
  }

  const pkg = path.join(dest, 'package.json');
  if (!fs.existsSync(pkg)) {
    console.error('.next/package.json is missing after copy; aborting');
    process.exit(2);
  }

  console.log('Successfully copied .next to', dest);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
