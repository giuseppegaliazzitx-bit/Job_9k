import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = resolve(root, "data");

const dirs = [
  data,
  resolve(data, "resumes"),
  resolve(data, "screenshots"),
  resolve(data, "cover-letters"),
  resolve(data, "browser-profile"),
];

for (const dir of dirs) mkdirSync(dir, { recursive: true });

const copies = [
  ["data/profile.example.yml", "data/profile.yml"],
  ["data/answers.example.yml", "data/answers.yml"],
  ["data/settings.example.yml", "data/settings.yml"],
];

for (const [from, to] of copies) {
  const src = resolve(root, from);
  const dest = resolve(root, to);
  if (!existsSync(dest)) {
    copyFileSync(src, dest);
    console.log(`created ${to}`);
  } else {
    console.log(`kept existing ${to}`);
  }
}

console.log("Setup complete. Edit data/profile.yml, drop a PDF in data/resumes/, then run: npm run dev");
