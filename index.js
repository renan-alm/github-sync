import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { createAppAuth } from "@octokit/auth-app";

async function getAppInstallationToken(appId, privateKey, installationId) {
  const auth = createAppAuth({
    appId,
    privateKey,
    installationId,
  });
  const { token } = await auth({ type: "installation" });
  return token;
}

function readInputs() {
  return {
    sourceRepo: core.getInput("source_repo", { required: true }),
    sourceBranch: core.getInput("source_branch", { required: true }),
    destinationRepo: core.getInput("destination_repo", { required: true }),
    destinationBranch: core.getInput("destination_branch", { required: true }),
    syncTags: core.getInput("sync_tags"),
    sourceToken: core.getInput("source_token"),
    syncAllBranches: core.getInput("sync_all_branches") === "true",
    githubAppId: core.getInput("github_app_id"),
    githubAppPrivateKey: core.getInput("github_app_private_key"),
    githubAppInstallationId: core.getInput("github_app_installation_id"),
    githubToken: core.getInput("github_token"),
  };
}

function logInputs(inputs) {
  core.info(`Source: ${inputs.sourceRepo} (branch: ${inputs.sourceBranch})`);
  core.info(
    `Destination: ${inputs.destinationRepo} (branch: ${inputs.destinationBranch})`,
  );
  core.info(`Sync all branches: ${inputs.syncAllBranches}`);
  core.info(`Sync tags: ${inputs.syncTags || "false"}`);
}

async function authenticate(inputs) {
  if (inputs.githubToken) {
    core.info("Using GitHub Personal Access Token for authentication...");
    return inputs.githubToken;
  } else if (
    inputs.githubAppId &&
    inputs.githubAppPrivateKey &&
    inputs.githubAppInstallationId
  ) {
    core.info("Authenticating as GitHub App installation...");
    const token = await getAppInstallationToken(
      inputs.githubAppId,
      inputs.githubAppPrivateKey,
      inputs.githubAppInstallationId,
    );
    core.info("GitHub App token obtained successfully");
    return token;
  } else {
    throw new Error(
      "Either github_token (PAT) or github_app credentials (app_id, private_key, installation_id) must be provided",
    );
  }
}

async function setupGitConfig() {
  core.info("=== Setting up Git Configuration ===");
  core.info("Configuring git user...");
  try {
    await exec.exec("git", [
      "config",
      "--global",
      "user.name",
      "github-sync-action",
    ]);
    await exec.exec("git", [
      "config",
      "--global",
      "user.email",
      "github-sync@github.com",
    ]);
    core.info("✓ Git user configured");
  } catch (error) {
    core.warning(`Could not set git config: ${error.message}`);
  }
}

function prepareUrls(
  sourceRepo,
  destinationRepo,
  destinationToken,
  sourceToken,
) {
  core.info("=== Preparing URLs with Authentication ===");

  let srcUrl = sourceRepo;
  let dstUrl = destinationRepo;

  if (destinationToken && dstUrl.startsWith("https://")) {
    dstUrl = dstUrl.replace(
      "https://",
      `https://x-access-token:${destinationToken}@`,
    );
    core.info("✓ Destination URL prepared with authentication");
    core.debug(
      `Destination URL: ${dstUrl.replace(/x-access-token:.*@/, "x-access-token:***@")}`,
    );
  }

  // Use sourceToken if provided, otherwise fall back to destinationToken for source
  const effectiveSourceToken = sourceToken || destinationToken;
  
  if (effectiveSourceToken && srcUrl.startsWith("https://")) {
    srcUrl = srcUrl.replace(
      "https://",
      `https://x-access-token:${effectiveSourceToken}@`,
    );
    if (sourceToken) {
      core.info("✓ Source URL prepared with explicit token");
    } else {
      core.info("✓ Source URL prepared with destination token");
    }
    core.debug(
      `Source URL: ${srcUrl.replace(/x-access-token:.*@/, "x-access-token:***@")}`,
    );
  }

  return { srcUrl, dstUrl };
}

async function cloneDestinationRepo(dstUrl) {
  core.info("=== Cloning Destination Repository ===");
  core.info(
    `Cloning: ${dstUrl.replace(/x-access-token:.*@/, "x-access-token:***@")}`,
  );
  try {
    await exec.exec("git", ["clone", dstUrl, "repo"]);
    core.info("✓ Destination repository cloned successfully");
  } catch (error) {
    core.error(`✗ Clone failed: ${error.message}`);
    throw error;
  }

  core.info("Git repository initialized");
}

async function setupSourceRemote(srcUrl) {
  core.info("=== Setting up Source Remote ===");

  let remotes = "";
  try {
    await exec.exec("git", ["remote"], {
      listeners: {
        stdout: (data) => {
          remotes += data.toString();
        },
      },
    });
  } catch (error) {
    core.warning("Could not list remotes");
  }

  const remoteList = remotes.split(/\r?\n/).filter((line) => line.trim());
  const sourceRemoteExists = remoteList.includes("source");

  if (!sourceRemoteExists) {
    core.info("Adding source remote...");
    await exec.exec("git", ["remote", "add", "source", srcUrl]);
    core.info("✓ Source remote added");
  } else {
    core.info("Updating existing source remote...");
    await exec.exec("git", ["remote", "set-url", "source", srcUrl]);
    core.info("✓ Source remote updated");
  }

  core.info("Fetching from source...");
  await exec.exec("git", ["fetch", "source"]);
  core.info("✓ Fetch from source completed");
}

/**
 * Helper: Get available branches from source remote
 */
async function getSourceBranches() {
  let stdout = "";
  try {
    await exec.exec("git", ["branch", "-r"], {
      listeners: {
        stdout: (data) => {
          stdout += data.toString();
        },
      },
    });
  } catch (error) {
    core.error(`Could not list branches: ${error.message}`);
    throw error;
  }

  const branchNames = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("source/") && !line.includes("->"))
    .map((line) => line.replace("source/", ""));

  return branchNames;
}

async function syncBranches(sourceBranch, destinationBranch, syncAllBranches) {
  if (syncAllBranches) {
    core.info("=== Syncing All Branches ===");

    const branchNames = await getSourceBranches();
    core.info(`Found ${branchNames.length} branches to sync`);

    for (const branch of branchNames) {
      core.info(`Syncing branch: ${branch}`);
      await exec.exec("git", [
        "push",
        "origin",
        `refs/remotes/source/${branch}:refs/heads/${branch}`,
        "--force",
      ]);
      core.info(`✓ Branch synced: ${branch}`);
    }
  } else {
    core.info("=== Syncing Single Branch ===");
    
    // Check available branches first
    const availableBranches = await getSourceBranches();
    
    if (!availableBranches.includes(sourceBranch)) {
      throw new Error(
        `Branch "${sourceBranch}" not found in source repository. Available branches: ${availableBranches.join(", ") || "none"}`
      );
    }

    core.info(`Syncing branch: ${sourceBranch} → ${destinationBranch}`);
    await exec.exec("git", [
      "push",
      "origin",
      `refs/remotes/source/${sourceBranch}:refs/heads/${destinationBranch}`,
      "--force",
    ]);
    core.info(`✓ Branch synced: ${sourceBranch} → ${destinationBranch}`);
  }
}

async function syncTags(syncTags) {
  if (syncTags === "true") {
    core.info("=== Syncing All Tags ===");
    core.info("Fetching tags...");
    await exec.exec("git", ["fetch", "source", "--tags"]);
    core.info("✓ Tags fetched");

    core.info("Pushing tags...");
    await exec.exec("git", ["push", "origin", "--tags", "--force"]);
    core.info("✓ Tags pushed");
  } else if (syncTags) {
    core.info("=== Syncing Tags Matching Pattern ===");
    core.info(`Pattern: ${syncTags}`);

    core.info("Fetching tags...");
    await exec.exec("git", ["fetch", "source", "--tags"]);
    core.info("✓ Tags fetched");

    let stdout = "";
    await exec.exec("git", ["tag"], {
      listeners: {
        stdout: (data) => {
          stdout += data.toString();
        },
      },
    });

    const allTags = stdout.split(/\r?\n/).filter((tag) => tag.trim());
    const matchingTags = allTags.filter((tag) => tag.match(syncTags));

    core.info(`Found ${matchingTags.length} matching tags`);

    for (const tag of matchingTags) {
      if (tag) {
        core.info(`Pushing tag: ${tag}`);
        await exec.exec("git", [
          "push",
          "origin",
          `refs/tags/${tag}:refs/tags/${tag}`,
          "--force",
        ]);
        core.info(`✓ Tag pushed: ${tag}`);
      }
    }
  } else {
    core.info("Tag syncing disabled");
  }
}

async function run() {
  try {
    core.info("=== GitHub Sync Action Started ===");

    const inputs = readInputs();
    logInputs(inputs);

    const destinationToken = await authenticate(inputs);

    await setupGitConfig();

    const { srcUrl, dstUrl } = prepareUrls(
      inputs.sourceRepo,
      inputs.destinationRepo,
      destinationToken,
      inputs.sourceToken,
    );

    await cloneDestinationRepo(dstUrl);
    process.chdir("repo");

    await setupSourceRemote(srcUrl);

    await syncBranches(
      inputs.sourceBranch,
      inputs.destinationBranch,
      inputs.syncAllBranches,
    );

    await syncTags(inputs.syncTags);

    core.info("=== GitHub Sync Completed Successfully ===");
    core.info("Sync complete!");
  } catch (error) {
    core.error("=== GitHub Sync Failed ===");
    core.setFailed(error.message);
  }
}

run();
