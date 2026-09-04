/**
 * 为当前平台下载 Apache Maven + Eclipse Temurin JDK，打入 Tauri 安装包。
 * 输出：src-tauri/resources/bundle-tools/{maven,jdk,manifest.json}
 *
 * 跳过：已存在有效 manifest 且目录完整（设 FORCE_BUNDLE_TOOLS=1 强制重下）
 * 瘦身：去掉 jmods/src.zip/CDS 等打包不需要的部件，显著缩小安装包与打包耗时
 */
import { spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "src-tauri/resources/bundle-tools");
const MAVEN_VERSION = "3.9.9";
const JDK_MAJOR = "21";
/**  bump 后本地/CI 会在不重下的情况下重新 slim */
const SLIM_VERSION = 2;

function platformKey() {
  const os = process.platform;
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  if (os === "darwin") return { os: "mac", arch, isWin: false, isMac: true };
  if (os === "win32") return { os: "windows", arch: "x64", isWin: true, isMac: false };
  return { os: "linux", arch: "x64", isWin: false, isMac: false };
}

function mavenArchiveUrl({ isWin }) {
  const ext = isWin ? "zip" : "tar.gz";
  const file = `apache-maven-${MAVEN_VERSION}-bin.${ext}`;
  // dlcdn 仅保留最新版，旧版会 404；archive 长期可用
  return `https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/${file}`;
}

function jdkDownloadUrl({ os, arch }) {
  return `https://api.adoptium.net/v3/binary/latest/${JDK_MAJOR}/ga/${os}/${arch}/jdk/hotspot/normal/eclipse?project=jdk`;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
  }
}

async function download(url, dest) {
  console.log(`↓ ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function dirSizeBytes(root) {
  if (!existsSync(root)) return 0;
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else {
        try {
          total += statSync(p).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function mavenBinExists(dir) {
  if (!existsSync(dir)) return false;
  if (process.platform === "win32") {
    return (
      existsSync(join(dir, "bin", "mvn.cmd"))
      || existsSync(join(dir, "bin", "mvn.bat"))
      || existsSync(join(dir, "bin", "mvn"))
    );
  }
  return existsSync(join(dir, "bin", "mvn"));
}

function jdkHomeDir(jdkRoot) {
  const macHome = join(jdkRoot, "Contents", "Home");
  if (existsSync(join(macHome, "bin", "java")) || existsSync(join(macHome, "bin", "java.exe"))) {
    return macHome;
  }
  return jdkRoot;
}

function jdkBinExists(dir) {
  if (!existsSync(dir)) return false;
  const home = jdkHomeDir(dir);
  if (process.platform === "win32") {
    return existsSync(join(home, "bin", "java.exe"));
  }
  return existsSync(join(home, "bin", "java"));
}

function readManifest() {
  const manifestPath = join(OUT, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function toolsPresent() {
  const mavenDir = join(OUT, "maven");
  const jdkDir = join(OUT, "jdk");
  return mavenBinExists(mavenDir) && jdkBinExists(jdkDir);
}

function toolsReady() {
  if (!toolsPresent() || !existsSync(join(OUT, "manifest.json"))) return false;
  const m = readManifest();
  if (!m) return false;
  return (
    m.mavenVersion === MAVEN_VERSION
    && m.jdkMajor === JDK_MAJOR
    && m.slimVersion === SLIM_VERSION
  );
}

function needsReslim() {
  if (!toolsPresent()) return false;
  const m = readManifest();
  if (!m) return true;
  return m.slimVersion !== SLIM_VERSION;
}

function extractMaven(archivePath, { isWin }) {
  const tmp = join(OUT, "_extract-maven");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  if (isWin) {
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`,
    ]);
  } else {
    run("tar", ["-xzf", archivePath, "-C", tmp]);
  }
  const inner = join(tmp, `apache-maven-${MAVEN_VERSION}`);
  const target = join(OUT, "maven");
  rmSync(target, { recursive: true, force: true });
  run(process.platform === "win32" ? "powershell" : "mv", [
    ...(process.platform === "win32"
      ? ["-NoProfile", "-Command", `Move-Item -Path '${inner.replace(/'/g, "''")}' -Destination '${target.replace(/'/g, "''")}'`]
      : [inner, target]),
  ]);
  rmSync(tmp, { recursive: true, force: true });
}

function normalizeJdkLayout(target) {
  const macHome = join(target, "Contents", "Home");
  if (!existsSync(macHome)) return;
  const normalized = join(OUT, "_jdk-home");
  rmSync(normalized, { recursive: true, force: true });
  run("mv", [macHome, normalized]);
  rmSync(target, { recursive: true, force: true });
  run("mv", [normalized, target]);
  console.log("normalize jdk: flattened Contents/Home → jdk/");
}

function extractJdk(archivePath, plat) {
  const { isWin } = plat;
  const tmp = join(OUT, "_extract-jdk");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  if (isWin) {
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`,
    ]);
  } else {
    run("tar", ["-xzf", archivePath, "-C", tmp]);
  }
  const jdkRoot = readdirSync(tmp).find((n) => n.startsWith("jdk"));
  if (!jdkRoot) {
    throw new Error(`JDK extract: no jdk-* folder in ${tmp}`);
  }
  const inner = join(tmp, jdkRoot);
  const target = join(OUT, "jdk");
  rmSync(target, { recursive: true, force: true });
  if (isWin) {
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Move-Item -Path '${inner.replace(/'/g, "''")}' -Destination '${target.replace(/'/g, "''")}'`,
    ]);
  } else {
    run("mv", [inner, target]);
  }
  normalizeJdkLayout(target);
  rmSync(tmp, { recursive: true, force: true });
}

function chmodExecutables() {
  if (process.platform === "win32") return;
  const home = jdkHomeDir(join(OUT, "jdk"));
  const bins = [
    join(OUT, "maven", "bin", "mvn"),
    join(home, "bin", "java"),
    join(home, "bin", "javac"),
  ];
  for (const b of bins) {
    if (existsSync(b)) {
      run("chmod", ["+x", b]);
    }
  }
}

/**
 * 去掉打包不需要的 JDK 部件。
 * Maven 编译仍需要 javac + lib/modules + ct.sym；jmods/src.zip/CDS/文档可删。
 */
function slimJdk() {
  const jdk = join(OUT, "jdk");
  if (!existsSync(jdk)) return;

  normalizeJdkLayout(jdk);
  const home = jdkHomeDir(jdk);
  const before = dirSizeBytes(jdk);

  const dropRels = [
    "jmods",
    "lib/src.zip",
    "demo",
    "sample",
    "samples",
    "man",
    "include",
    "legal",
    // CDS 预热镜像：体积大，删了只影响冷启动几毫秒级
    "lib/server/classes.jsa",
    "lib/server/classes_nocoops.jsa",
  ];

  for (const rel of dropRels) {
    const p = join(home, rel);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      console.log(`slim jdk: removed ${rel}`);
    }
  }

  // 清掉可能残留的空 Contents 壳
  const contents = join(jdk, "Contents");
  if (existsSync(contents)) {
    rmSync(contents, { recursive: true, force: true });
    console.log("slim jdk: removed leftover Contents/");
  }

  const after = dirSizeBytes(jdk);
  console.log(`slim jdk: ${formatMb(before)} → ${formatMb(after)}`);
}

function writeManifest(plat) {
  const manifest = {
    mavenVersion: MAVEN_VERSION,
    jdkMajor: JDK_MAJOR,
    slimVersion: SLIM_VERSION,
    platform: `${plat.os}-${plat.arch}`,
    builtAt: new Date().toISOString(),
    sizes: {
      maven: formatMb(dirSizeBytes(join(OUT, "maven"))),
      jdk: formatMb(dirSizeBytes(join(OUT, "jdk"))),
    },
  };
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
}

async function main() {
  if (process.env.SKIP_BUNDLE_TOOLS === "1") {
    console.log("SKIP_BUNDLE_TOOLS=1，跳过内置 Maven/JDK 下载");
    // 保证 resources glob 至少能匹配到占位，避免空目录
    mkdirSync(OUT, { recursive: true });
    if (!existsSync(join(OUT, ".keep"))) {
      writeFileSync(join(OUT, ".keep"), "");
    }
    return;
  }

  const plat = platformKey();
  mkdirSync(OUT, { recursive: true });

  if (toolsReady() && process.env.FORCE_BUNDLE_TOOLS !== "1") {
    console.log(`bundle-tools 已就绪：${OUT}`);
    console.log(`  maven=${formatMb(dirSizeBytes(join(OUT, "maven")))} jdk=${formatMb(dirSizeBytes(join(OUT, "jdk")))}`);
    return;
  }

  // 已下载但 slim 版本落后：只重 slim，不重下
  if (needsReslim() && process.env.FORCE_BUNDLE_TOOLS !== "1") {
    console.log(`bundle-tools slimVersion 落后，重新瘦身…`);
    slimJdk();
    chmodExecutables();
    writeManifest(plat);
    rmSync(join(OUT, "_cache"), { recursive: true, force: true });
    if (!toolsReady()) {
      throw new Error("bundle-tools 校验失败：重新瘦身后仍不完整");
    }
    console.log(`✅ bundle-tools 已瘦身 ${OUT}`);
    return;
  }

  const cacheDir = join(OUT, "_cache");
  mkdirSync(cacheDir, { recursive: true });

  const mavenArchive = join(cacheDir, `apache-maven-${MAVEN_VERSION}${plat.isWin ? ".zip" : ".tar.gz"}`);
  const jdkArchive = join(cacheDir, `temurin-jdk-${JDK_MAJOR}${plat.isWin ? ".zip" : ".tar.gz"}`);

  await download(mavenArchiveUrl(plat), mavenArchive);
  extractMaven(mavenArchive, plat);

  await download(jdkDownloadUrl(plat), jdkArchive);
  extractJdk(jdkArchive, plat);

  slimJdk();
  chmodExecutables();
  writeManifest(plat);

  rmSync(cacheDir, { recursive: true, force: true });

  if (!toolsReady()) {
    throw new Error("bundle-tools 校验失败：maven/jdk 目录不完整");
  }
  console.log(`✅ bundle-tools 已写入 ${OUT}`);
  console.log(`  maven=${formatMb(dirSizeBytes(join(OUT, "maven")))} jdk=${formatMb(dirSizeBytes(join(OUT, "jdk")))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
