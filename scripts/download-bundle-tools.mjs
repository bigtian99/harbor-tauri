/**
 * 为当前平台下载 Apache Maven + Eclipse Temurin JDK，打入 Tauri 安装包。
 * 输出：src-tauri/resources/bundle-tools/{maven,jdk,manifest.json}
 *
 * 跳过：已存在有效 manifest 且目录完整（设 FORCE_BUNDLE_TOOLS=1 强制重下）
 */
import { spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
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

function jdkBinExists(dir) {
  if (!existsSync(dir)) return false;
  if (process.platform === "win32") {
    return existsSync(join(dir, "bin", "java.exe"));
  }
  if (process.platform === "darwin") {
    return (
      existsSync(join(dir, "bin", "java"))
      || existsSync(join(dir, "Contents", "Home", "bin", "java"))
    );
  }
  return existsSync(join(dir, "bin", "java"));
}

function toolsReady() {
  const mavenDir = join(OUT, "maven");
  const jdkDir = join(OUT, "jdk");
  const manifestPath = join(OUT, "manifest.json");
  if (!mavenBinExists(mavenDir) || !jdkBinExists(jdkDir) || !existsSync(manifestPath)) {
    return false;
  }
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    return m.mavenVersion === MAVEN_VERSION && m.jdkMajor === JDK_MAJOR;
  } catch {
    return false;
  }
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

function normalizeJdkLayout(target, { isMac }) {
  if (!isMac) return;
  const macHome = join(target, "Contents", "Home");
  if (!existsSync(macHome)) return;
  const normalized = join(OUT, "_jdk-home");
  rmSync(normalized, { recursive: true, force: true });
  run("mv", [macHome, normalized]);
  rmSync(target, { recursive: true, force: true });
  run("mv", [normalized, target]);
}

function extractJdk(archivePath, plat) {
  const { isWin, isMac } = plat;
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
  normalizeJdkLayout(target, { isMac });
  rmSync(tmp, { recursive: true, force: true });
}

function chmodExecutables() {
  if (process.platform === "win32") return;
  const bins = [
    join(OUT, "maven", "bin", "mvn"),
    join(OUT, "jdk", "bin", "java"),
  ];
  for (const b of bins) {
    if (existsSync(b)) {
      run("chmod", ["+x", b]);
    }
  }
}

async function main() {
  if (process.env.SKIP_BUNDLE_TOOLS === "1") {
    console.log("SKIP_BUNDLE_TOOLS=1，跳过内置 Maven/JDK 下载");
    return;
  }

  if (toolsReady() && process.env.FORCE_BUNDLE_TOOLS !== "1") {
    console.log(`bundle-tools 已就绪：${OUT}`);
    return;
  }

  const plat = platformKey();
  mkdirSync(OUT, { recursive: true });
  const cacheDir = join(OUT, "_cache");
  mkdirSync(cacheDir, { recursive: true });

  const mavenArchive = join(cacheDir, `apache-maven-${MAVEN_VERSION}${plat.isWin ? ".zip" : ".tar.gz"}`);
  const jdkArchive = join(cacheDir, `temurin-jdk-${JDK_MAJOR}${plat.isWin ? ".zip" : ".tar.gz"}`);

  await download(mavenArchiveUrl(plat), mavenArchive);
  extractMaven(mavenArchive, plat);

  await download(jdkDownloadUrl(plat), jdkArchive);
  await extractJdk(jdkArchive, plat);

  chmodExecutables();

  const manifest = {
    mavenVersion: MAVEN_VERSION,
    jdkMajor: JDK_MAJOR,
    platform: `${plat.os}-${plat.arch}`,
    builtAt: new Date().toISOString(),
  };
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  rmSync(cacheDir, { recursive: true, force: true });

  if (!toolsReady()) {
    throw new Error("bundle-tools 校验失败：maven/jdk 目录不完整");
  }
  console.log(`✅ bundle-tools 已写入 ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
