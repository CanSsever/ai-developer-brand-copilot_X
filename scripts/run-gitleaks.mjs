import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const version = "8.30.0";
const releaseBase = `https://github.com/gitleaks/gitleaks/releases/download/v${version}`;
const supportedAssets = {
  "linux-x64": {
    archive: `gitleaks_${version}_linux_x64.tar.gz`,
    checksum: "79a3ab579b53f71efd634f3aaf7e04a0fa0cf206b7ed434638d1547a2470a66e",
    executable: "gitleaks",
  },
  "win32-x64": {
    archive: `gitleaks_${version}_windows_x64.zip`,
    checksum: "54fe94f644b832dd08e8c3a5915efb3bfa862386d59fb27ca0792cb687a83573",
    executable: "gitleaks.exe",
  },
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function runScan(executablePath, argumentsList, cwd) {
  const scan = spawnSync(executablePath, argumentsList, {
    cwd,
    stdio: "inherit",
  });

  if (scan.error) throw scan.error;
  if (scan.status !== 0) {
    throw new Error("Gitleaks found a secret or could not complete the scan");
  }
}

async function main() {
  const platformKey = `${process.platform}-${process.arch}`;
  const asset = supportedAssets[platformKey];
  if (!asset) {
    throw new Error(`Unsupported secret-scan platform: ${platformKey}`);
  }

  const temporaryRoot = realpathSync(tmpdir());
  const workDirectory = mkdtempSync(join(temporaryRoot, "brand-copilot-gitleaks-"));
  const safePrefix = `${temporaryRoot}${sep}`;
  if (!resolve(workDirectory).startsWith(safePrefix)) {
    throw new Error("Unsafe temporary directory");
  }

  try {
    const response = await globalThis.fetch(`${releaseBase}/${asset.archive}`);
    if (!response.ok) {
      throw new Error(`Gitleaks download failed with HTTP ${response.status}`);
    }

    const archiveBytes = Buffer.from(await response.arrayBuffer());
    const actualChecksum = createHash("sha256").update(archiveBytes).digest("hex");
    if (actualChecksum !== asset.checksum) {
      throw new Error("Gitleaks archive checksum validation failed");
    }

    const archivePath = join(workDirectory, basename(asset.archive));
    writeFileSync(archivePath, archiveBytes);
    const extraction = spawnSync(
      "tar",
      ["-xf", archivePath, "-C", workDirectory],
      { stdio: "inherit" }
    );
    if (extraction.status !== 0) {
      throw new Error("Gitleaks archive extraction failed");
    }

    const executablePath = join(workDirectory, asset.executable);
    if (process.platform !== "win32") chmodSync(executablePath, 0o755);
    runScan(
      executablePath,
      [
        "git",
        "--redact",
        "--no-banner",
        "--no-color",
        "--log-opts=--all",
        ".",
      ],
      process.cwd()
    );

    const repositoryRoot = resolve(process.cwd());
    const trackableRoot = join(workDirectory, "trackable-files");
    mkdirSync(trackableRoot);
    const listedFiles = spawnSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: repositoryRoot, encoding: "utf8" }
    );
    if (listedFiles.error) throw listedFiles.error;
    if (listedFiles.status !== 0 || typeof listedFiles.stdout !== "string") {
      throw new Error("Could not enumerate trackable repository files");
    }

    for (const relativePath of listedFiles.stdout.split("\0").filter(Boolean)) {
      const source = resolve(repositoryRoot, relativePath);
      const destination = resolve(trackableRoot, relativePath);
      if (
        !source.startsWith(`${repositoryRoot}${sep}`) ||
        !destination.startsWith(`${trackableRoot}${sep}`) ||
        !lstatSync(source).isFile()
      ) {
        throw new Error("Unsafe trackable repository path");
      }
      mkdirSync(resolve(destination, ".."), { recursive: true });
      copyFileSync(source, destination);
    }

    runScan(
      executablePath,
      ["dir", "--redact", "--no-banner", "--no-color", trackableRoot],
      repositoryRoot
    );

    process.stdout.write(
      `Gitleaks v${version} history and trackable-content scans passed.\n`
    );
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Secret scan failed");
});
