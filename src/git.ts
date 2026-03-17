import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function detectGitBranch(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: projectRoot,
      windowsHide: true
    });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}
