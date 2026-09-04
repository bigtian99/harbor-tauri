/**
 * 打包前清理会误入安装包的杂物（模板 zip、.DS_Store），减小包体与拷贝耗时。
 * 不改动真实模板目录结构，只删明确无用的文件。
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = join(ROOT, "templates");

function removeIfExists(path, label) {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
  console.log(`prepare-bundle: removed ${label}`);
}

function main() {
  if (!existsSync(TEMPLATES)) {
    console.log("prepare-bundle: templates/ 不存在，跳过");
    return;
  }

  // 根目录误放的归档 zip（曾达 ~37MB）
  for (const name of readdirSync(TEMPLATES)) {
    const p = join(TEMPLATES, name);
    try {
      if (statSync(p).isFile() && name.toLowerCase().endsWith(".zip")) {
        removeIfExists(p, `templates/${name}`);
      }
    } catch {
      /* ignore */
    }
  }

  // 递归清 .DS_Store
  const stack = [TEMPLATES];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.name === ".DS_Store") removeIfExists(p, p.replace(ROOT + "/", ""));
    }
  }

  console.log("prepare-bundle: done");
}

main();
