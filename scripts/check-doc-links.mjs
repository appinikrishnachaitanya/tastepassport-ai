/** Offline check of local Markdown file targets; external URLs and fragments are not fetched. */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? markdownFiles(path.join(directory, entry.name))
    : entry.name.endsWith(".md") ? [path.join(directory, entry.name)] : []));
  return nested.flat();
}
const files = [path.join(root,"README.md"), path.join(root,"app/styles/README.md"), ...await markdownFiles(path.join(root,"docs"))];
const failures = [];
for (const file of files) {
  const text = await readFile(file,"utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g,"");
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
    const location = target.split("#")[0];
    if (!location) continue;
    try { await stat(path.resolve(path.dirname(file),decodeURIComponent(location))); }
    catch { failures.push(`${path.relative(root,file)} → ${location}`); }
  }
}
if (failures.length) {
  console.error(`Documentation links FAIL (${failures.length}):\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log(`Documentation links PASS: ${files.length} Markdown files; local file targets exist.`);
