import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const start = join(root, "src", "browser.ts");
const parent = new Map();
const queue = [start];
const seen = new Set();

while (queue.length > 0) {
  const file = queue.shift();
  const norm = file.replaceAll("\\", "/");
  if (seen.has(norm)) {
    continue;
  }
  seen.add(norm);
  if (norm.endsWith("/return-token.ts")) {
    const chain = [];
    let cur = norm;
    while (cur) {
      chain.push(cur);
      cur = parent.get(cur);
    }
    console.log(chain.reverse().join("\n  -> "));
    process.exit(0);
  }
  let src = "";
  try {
    src = await readFile(file, "utf8");
  } catch {
    continue;
  }
  for (const match of src.matchAll(/from ["'](\.[^"']+)["']/g)) {
    const spec = match[1];
    const dir = dirname(file);
    const candidates = [
      join(dir, spec),
      `${join(dir, spec)}.ts`,
      join(dir, spec, "index.ts"),
    ];
    for (const cand of candidates) {
      try {
        await readFile(cand);
        const cn = cand.replaceAll("\\", "/");
        if (!(parent.has(cn) || seen.has(cn))) {
          parent.set(cn, norm);
        }
        queue.push(cand);
        break;
      } catch {
        // try next
      }
    }
  }
}
console.log("not found, visited", seen.size);
