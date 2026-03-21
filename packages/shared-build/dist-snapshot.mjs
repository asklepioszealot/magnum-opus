import fs from "fs";
import path from "path";

function resolveProjectPath(projectDir, targetPath) {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.resolve(projectDir, targetPath);
}

function copyExtraEntry(projectDir, distPath, entry) {
  const fromRelativePath = typeof entry === "string" ? entry : entry.from;
  const toRelativePath =
    typeof entry === "string"
      ? path.basename(fromRelativePath)
      : entry.to || path.basename(fromRelativePath);

  const fromPath = resolveProjectPath(projectDir, fromRelativePath);
  const toPath = path.join(distPath, toRelativePath);

  if (!fs.existsSync(fromPath)) {
    throw new Error(`Extra copy source not found: ${fromPath}`);
  }

  const fromStat = fs.statSync(fromPath);
  fs.mkdirSync(path.dirname(toPath), { recursive: true });

  if (fromStat.isDirectory()) {
    fs.cpSync(fromPath, toPath, { recursive: true });
    return;
  }

  fs.copyFileSync(fromPath, toPath);
}

function readAppVersion(projectDir, tauriConfigRelativePath) {
  const tauriConfigPath = path.join(projectDir, tauriConfigRelativePath);
  try {
    const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
    if (typeof config.version === "string" && config.version.trim().length > 0) {
      return config.version.trim();
    }
  } catch {
    // fall through to unknown
  }

  return "unknown";
}

function resolveGitDir(startDir) {
  let currentDir = startDir;

  while (true) {
    const gitPath = path.join(currentDir, ".git");
    if (fs.existsSync(gitPath)) {
      const gitStat = fs.statSync(gitPath);
      if (gitStat.isDirectory()) {
        return gitPath;
      }

      const pointerRaw = fs.readFileSync(gitPath, "utf8").trim();
      const pointerMatch = pointerRaw.match(/^gitdir:\s*(.+)$/i);
      if (!pointerMatch) {
        return null;
      }

      return path.resolve(currentDir, pointerMatch[1].trim());
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function resolveHeadHash(gitDir) {
  const headPath = path.join(gitDir, "HEAD");
  if (!fs.existsSync(headPath)) {
    return null;
  }

  const headRaw = fs.readFileSync(headPath, "utf8").trim();
  if (/^[0-9a-f]{40}$/i.test(headRaw)) {
    return headRaw;
  }

  const refMatch = headRaw.match(/^ref:\s*(.+)$/i);
  if (!refMatch) {
    return null;
  }

  const refName = refMatch[1].trim();
  const refPath = path.join(gitDir, refName.replace(/\//g, path.sep));
  if (fs.existsSync(refPath)) {
    return fs.readFileSync(refPath, "utf8").trim();
  }

  const packedRefsPath = path.join(gitDir, "packed-refs");
  if (fs.existsSync(packedRefsPath)) {
    const packedLines = fs.readFileSync(packedRefsPath, "utf8").split(/\r?\n/);
    for (const line of packedLines) {
      if (!line || line.startsWith("#") || line.startsWith("^")) continue;
      const [hash, name] = line.split(" ");
      if (name === refName && /^[0-9a-f]{40}$/i.test(hash || "")) {
        return hash;
      }
    }
  }

  return null;
}

function readGitCommit(projectDir) {
  try {
    const gitDir = resolveGitDir(projectDir);
    if (!gitDir) return "nogit";
    const fullHash = resolveHeadHash(gitDir);
    if (!fullHash) return "nogit";
    return fullHash.slice(0, 7);
  } catch {
    return "nogit";
  }
}

function makeBuildInfo(projectDir, tauriConfigRelativePath) {
  const version = readAppVersion(projectDir, tauriConfigRelativePath);
  const commit = readGitCommit(projectDir);
  const builtAt = new Date().toISOString();
  const buildId = `${version}-${commit}-${builtAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;

  return {
    version,
    commit,
    builtAt,
    buildId,
    source: "dist-snapshot",
  };
}

export function buildDistSnapshot(options = {}) {
  const {
    projectDir = process.cwd(),
    distDir = "dist",
    srcDir = "src",
    dataDir = "data",
    indexFile = "index.html",
    extraCopies = [],
    includeBuildInfo = false,
    tauriConfigRelativePath = path.join("src-tauri", "tauri.conf.json"),
    generatedBuildInfoRelativePath = path.join("src", "generated", "build-info.js"),
  } = options;

  const distPath = path.join(projectDir, distDir);
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true, force: true });
  }

  fs.mkdirSync(distPath, { recursive: true });
  fs.copyFileSync(path.join(projectDir, indexFile), path.join(distPath, "index.html"));

  const srcPath = path.join(projectDir, srcDir);
  if (fs.existsSync(srcPath)) {
    fs.cpSync(srcPath, path.join(distPath, "src"), { recursive: true });
  }

  const dataPath = path.join(projectDir, dataDir);
  if (fs.existsSync(dataPath)) {
    fs.cpSync(dataPath, path.join(distPath, "data"), { recursive: true });
  }

  extraCopies.forEach((entry) => {
    copyExtraEntry(projectDir, distPath, entry);
  });

  if (!includeBuildInfo) {
    console.log("Build complete.");
    return null;
  }

  const buildInfo = makeBuildInfo(projectDir, tauriConfigRelativePath);
  const buildInfoScript = `window.__BUILD_INFO__ = Object.freeze(${JSON.stringify(buildInfo, null, 2)});\n`;
  const generatedBuildInfoPath = path.join(distPath, generatedBuildInfoRelativePath);

  fs.mkdirSync(path.dirname(generatedBuildInfoPath), { recursive: true });
  fs.writeFileSync(generatedBuildInfoPath, buildInfoScript, "utf8");
  fs.writeFileSync(path.join(distPath, "build-metadata.json"), `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(distPath, "build-id.txt"), `${buildInfo.buildId}\n`, "utf8");

  console.log(`Build complete. Build ID: ${buildInfo.buildId}`);
  return buildInfo;
}
