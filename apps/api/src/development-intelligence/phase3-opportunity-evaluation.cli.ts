import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runPhase3DevelopmentScorerEvaluation } from "./phase3-opportunity-evaluation";

export interface Phase3EvaluationCliOptions {
  readonly outputPath: string | null;
}

export function parsePhase3EvaluationCliArguments(args: readonly string[]): Phase3EvaluationCliOptions {
  let outputPath: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing --output path");
      outputPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported Phase 3 DEV evaluation argument: ${argument ?? ""}`);
  }
  return { outputPath };
}

function currentGitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

export async function runPhase3EvaluationCli(args: readonly string[]): Promise<string> {
  const options = parsePhase3EvaluationCliArguments(args);
  const rubricPath = resolve(process.cwd(), "../../docs/product/PHASE_3_EVALUATION_CORPUS.md");
  const rubricText = await readFile(rubricPath, "utf8");
  const report = runPhase3DevelopmentScorerEvaluation({ rubricText, gitSha: currentGitSha() });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath) {
    await writeFile(resolve(options.outputPath), output, { encoding: "utf8", flag: "wx" });
  }
  return output;
}

async function main(): Promise<void> {
  const output = await runPhase3EvaluationCli(process.argv.slice(2));
  if (!process.argv.includes("--output")) process.stdout.write(output);
}

if (require.main === module) void main();
