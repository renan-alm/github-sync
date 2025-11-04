import { writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { execSync } from "child_process";
import simpleGit from "simple-git";

/**
 * Initialize a git instance for the current directory
 * @returns {SimpleGit} The git instance
 */
function getGit() {
  return simpleGit(process.cwd());
}

/**
 * Validates that GITHUB_TOKEN is set
 * @throws {Error} If GITHUB_TOKEN is not set
 */
export function validateGitHubToken() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("Set the GITHUB_TOKEN environment variable.");
  }
}

/**
 * Sets up SSH key if SSH_PRIVATE_KEY is provided
 */
export function setupSSHKey() {
  if (process.env.SSH_PRIVATE_KEY) {
    console.log("Saving SSH_PRIVATE_KEY");

    const sshDir = `${homedir()}/.ssh`;
    mkdirSync(sshDir, { recursive: true });

    const keyPath = `${sshDir}/id_rsa`;
    writeFileSync(keyPath, process.env.SSH_PRIVATE_KEY);
    execSync(`chmod 600 ${keyPath}`);

    // Disable strict host key checking
    const sshConfigContent = "StrictHostKeyChecking no\n";
    const sshConfigPath = `${sshDir}/config`;
    writeFileSync(sshConfigPath, sshConfigContent, { flag: "a" });
  }
}

/**
 * Normalizes the upstream repository URL
 * @param {string} upstreamRepo - The upstream repository URL or GitHub slug
 * @returns {string} The normalized HTTPS Git URL
 */
export function normalizeRepositoryUrl(upstreamRepo) {
  // Check if it's already a valid git URI
  if (/:|@|\.git\/?$/.test(upstreamRepo)) {
    return upstreamRepo;
  }

  // Assume it's a GitHub repo slug (owner/repo)
  console.log(
    "UPSTREAM_REPO does not seem to be a valid git URI, assuming it's a GitHub repo",
  );
  console.log(`Originally: ${upstreamRepo}`);

  const normalizedUrl = `https://github.com/${upstreamRepo}.git`;
  console.log(`Now: ${normalizedUrl}`);

  return normalizedUrl;
}

/**
 * Parses branch mapping string (source:destination)
 * @param {string} branchMapping - The branch mapping string
 * @returns {object} Object with source and destination branches
 */
export function parseBranchMapping(branchMapping) {
  const [source, destination] = branchMapping.split(":");

  if (!source || !destination) {
    throw new Error(
      "Invalid branch mapping format. Expected: SOURCE_BRANCH:DESTINATION_BRANCH",
    );
  }

  return { source, destination };
}

/**
 * Configures git authentication and remote URLs
 * @param {string} upstreamRepo - The upstream repository URL
 */
export async function configureGit(upstreamRepo) {
  const { GITHUB_ACTOR, GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;

  if (!GITHUB_ACTOR || !GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    throw new Error(
      "Missing required GitHub environment variables: GITHUB_ACTOR, GITHUB_TOKEN, GITHUB_REPOSITORY",
    );
  }

  console.log(`UPSTREAM_REPO=${upstreamRepo}`);

  const git = getGit();

  try {
    // Unset any existing http extra headers
    await git.raw([
      "config",
      "--unset-all",
      "http.https://github.com/.extraheader",
    ]);
  } catch {
    // Ignore if not set
  }

  // Configure origin remote with authentication
  const originUrl = `https://${GITHUB_ACTOR}:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}`;
  console.log(
    `Resetting origin to: https://${GITHUB_ACTOR}:***@github.com/${GITHUB_REPOSITORY}`,
  );
  await git.remote(["set-url", "origin", originUrl]);

  // Add upstream remote
  console.log(`Adding tmp_upstream ${upstreamRepo}`);
  try {
    await git.remote(["rm", "tmp_upstream"]);
  } catch {
    // Remote might not exist yet
  }
  await git.remote(["add", "tmp_upstream", upstreamRepo]);
}

/**
 * Syncs a branch from upstream to origin
 * @param {string} sourceBranch - The source branch name
 * @param {string} destinationBranch - The destination branch name
 */
export async function syncBranch(sourceBranch, destinationBranch) {
  const git = getGit();

  console.log("Fetching tmp_upstream");
  await git.fetch("tmp_upstream", [], { "--quiet": null });

  const remotes = await git.remote([]);
  console.log("Remotes:", remotes);

  console.log("Pushing changes from tmp_upstream to origin");
  await git.raw([
    "push",
    "origin",
    `refs/remotes/tmp_upstream/${sourceBranch}:refs/heads/${destinationBranch}`,
    "--force",
  ]);
}

/**
 * Syncs tags based on SYNC_TAGS environment variable
 */
export async function syncTags() {
  const { SYNC_TAGS } = process.env;

  if (!SYNC_TAGS) {
    return;
  }

  const git = getGit();

  if (SYNC_TAGS === "true") {
    console.log("Force syncing all tags");
    // Delete all local tags
    const localTags = await git.tag(["-l"]);
    if (localTags) {
      const tagList = localTags.split("\n").filter((t) => t);
      if (tagList.length > 0) {
        await git.tag(["-d", ...tagList]);
      }
    }
    await git.fetch("tmp_upstream", [], { "--tags": null, "--quiet": null });
    await git.push("origin", [], { "--tags": null, "--force": null });
  } else {
    console.log(`Force syncing tags matching pattern: ${SYNC_TAGS}`);
    // Delete all local tags
    const localTags = await git.tag(["-l"]);
    if (localTags) {
      const tagList = localTags.split("\n").filter((t) => t);
      if (tagList.length > 0) {
        await git.tag(["-d", ...tagList]);
      }
    }
    await git.fetch("tmp_upstream", [], { "--tags": null, "--quiet": null });

    // Push matching tags
    const allTags = await git.tag(["-l"]);
    if (allTags) {
      const matchingTags = allTags
        .split("\n")
        .filter((t) => t && t.includes(SYNC_TAGS));
      if (matchingTags.length > 0) {
        await git.push("origin", matchingTags, { "--force": null });
      }
    }
  }
}

/**
 * Cleans up temporary remotes
 */
export async function cleanupRemotes() {
  const git = getGit();

  console.log("Removing tmp_upstream");
  try {
    await git.remote(["rm", "tmp_upstream"]);
  } catch {
    // Remote might already be removed
  }

  const remotes = await git.remote([]);
  console.log("Remotes:", remotes);
}

/**
 * Main sync function that orchestrates the repository sync
 * @param {string} upstreamRepo - The upstream repository URL or GitHub slug
 * @param {string} branchMapping - The branch mapping (source:destination)
 */
export async function sync(upstreamRepo, branchMapping) {
  if (!upstreamRepo) {
    throw new Error("Missing $UPSTREAM_REPO");
  }

  if (!branchMapping) {
    throw new Error("Missing $SOURCE_BRANCH:$DESTINATION_BRANCH");
  }

  const normalizedUrl = normalizeRepositoryUrl(upstreamRepo);
  const { source, destination } = parseBranchMapping(branchMapping);

  console.log(`BRANCHES=${branchMapping}`);

  await configureGit(normalizedUrl);
  await syncBranch(source, destination);
  await syncTags();
  await cleanupRemotes();

  console.log("Sync completed successfully!");
}
