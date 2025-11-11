import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { createAppAuth } from "@octokit/auth-app";
import {
  isGerritRepository,
  syncBranchesGerrit,
  syncTagsGerrit,
  logGerritInfo,
} from "./gerrit.js";
import {
  validateAuthentication,
  logValidationResult,
} from "./auth-validation.js";
import {
  readSSHInputs,
  isSSHUrl,
  detectAuthenticationMethods,
  setupSSHAuthentication,
} from "./ssh-auth.js";

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
    githubToken: core.getInput("github_token"),
    sourceToken: core.getInput("source_token"),
    destinationToken: core.getInput("destination_token"),
    syncAllBranches: core.getInput("sync_all_branches") === "true",
    useMainAsFallback: core.getInput("use_main_as_fallback") !== "false", // Default to true
    githubAppId: core.getInput("github_app_id"),
    githubAppPrivateKey: core.getInput("github_app_private_key"),
    githubAppInstallationId: core.getInput("github_app_installation_id"),
    // SSH inputs
    sshKey: core.getInput("ssh_key"),
    sshKeyPath: core.getInput("ssh_key_path"),
    sshPassphrase: core.getInput("ssh_passphrase"),
    sshKnownHostsPath: core.getInput("ssh_known_hosts_path"),
    sshStrictHostKeyChecking: core.getInput("ssh_strict_host_key_checking") !== "false",
  };
}

/**
 * Extract hostname from SSH URL
 * Supports: git@github.com:user/repo.git or ssh://github.com/user/repo.git
 */
function extractSSHHostname(url) {
  if (!url) return null;
  
  if (url.startsWith("git@")) {
    // Format: git@github.com:user/repo.git
    const match = url.match(/git@([^:]+):/);
    return match ? match[1] : null;
  } else if (url.startsWith("ssh://")) {
    // Format: ssh://github.com/user/repo.git
    const match = url.match(/ssh:\/\/([^/]+)\//);
    return match ? match[1] : null;
  }
  return null;
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
  // Check if using SSH authentication
  const authMethods = detectAuthenticationMethods(inputs.sourceRepo, inputs.destinationRepo);

  if (authMethods.needsSSH) {
    core.info("SSH authentication detected for one or more repositories");
    // For SSH, token-based auth is not needed; return null
    // SSH agent will handle authentication
    return null;
  }

  // Token-based authentication (HTTPS)
  // Priority: destination_token (if provided) > github_token > github_app > error
  
  if (inputs.destinationToken) {
    core.info("Using destination-specific Personal Access Token for HTTPS authentication...");
    return inputs.destinationToken;
  } else if (inputs.githubToken) {
    core.info("Using GitHub Personal Access Token for HTTPS authentication...");
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
      "Authentication required: Either github_token (PAT), github_app credentials, or ssh_key must be provided",
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

  // Only embed tokens for HTTPS URLs; SSH URLs will use SSH agent
  if (destinationToken && dstUrl.startsWith("https://")) {
    dstUrl = dstUrl.replace(
      "https://",
      `https://x-access-token:${destinationToken}@`,
    );
    core.info("✓ Destination URL prepared with HTTPS token authentication");
    core.debug(
      `Destination URL: ${dstUrl.replace(/x-access-token:.*@/, "x-access-token:***@")}`,
    );
  } else if (isSSHUrl(dstUrl)) {
    core.info("✓ Destination URL is SSH-based, will use SSH agent authentication");
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
  } else if (isSSHUrl(srcUrl)) {
    core.info("✓ Source URL is SSH-based, will use SSH agent authentication");
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

/**
 * Helper: Try to find a fallback branch (main or master)
 */
async function getTryFallbackBranch(availableBranches) {
  // Try main first, then master
  const fallbackOptions = ["main", "master"];

  for (const branch of fallbackOptions) {
    if (availableBranches.includes(branch)) {
      core.info(`Found fallback branch: ${branch}`);
      return branch;
    }
  }

  return null;
}

/**
 * Calculate merge base between destination and source branches
 * @param {string} destBranch - Destination branch (e.g., origin/main)
 * @param {string} sourceBranch - Source branch (e.g., source/main)
 * @returns {Promise<string|null>} Merge base commit hash or null if no common history
 */
async function getMergeBase(destBranch, sourceBranch) {
  try {
    let stdout = "";
    await exec.exec("git", ["merge-base", destBranch, sourceBranch], {
      listeners: {
        stdout: (data) => {
          stdout += data.toString();
        },
      },
      ignoreReturnCode: true,
    });
    const mergeBase = stdout.trim();
    return mergeBase || null;
  } catch (error) {
    core.debug(`Could not find merge base: ${error.message}`);
    return null;
  }
}

/**
 * Get the commit hash of a reference
 * @param {string} ref - Git reference (e.g., origin/main, source/main)
 * @returns {Promise<string|null>} Commit hash or null if not found
 */
async function getRefCommit(ref) {
  let stdout = "";
  let exitCode = 0;
  try {
    exitCode = await exec.exec("git", ["rev-parse", ref], {
      listeners: {
        stdout: (data) => {
          stdout += data.toString();
        },
      },
      ignoreReturnCode: true,
    });
  } catch (error) {
    core.debug(`Could not resolve reference: ${error.message}`);
    return null;
  }

  // If git command failed (exit code !== 0), ref doesn't exist
  if (exitCode !== 0) {
    core.debug(`Reference ${ref} does not exist (exit code: ${exitCode})`);
    return null;
  }

  const commit = stdout.trim();
  return commit || null;
}

/**
 * Check if destination branch has been modified (contains commits not in source)
 * @param {string} destRef - Destination ref (e.g., origin/main)
 * @param {string} sourceRef - Source ref (e.g., source/main)
 * @returns {Promise<object>} Object with { isModified: boolean, details: string }
 */
async function hasDestinationBeenModified(destRef, sourceRef) {
  // FIRST: Check if destination and source refs exist (before merge-base to avoid errors)
  const sourceCommit = await getRefCommit(sourceRef);
  const destCommit = await getRefCommit(destRef);

  if (!destCommit) {
    // Destination branch doesn't exist yet, not modified
    // This is safe to push to (new branch or empty repo)
    return { isModified: false, details: "Destination branch does not exist" };
  }

  if (!sourceCommit) {
    // Source doesn't exist, can't compare
    return { isModified: false, details: "Source branch does not exist" };
  }

  // SECOND: Both exist, now find merge-base to detect divergence
  const mergeBase = await getMergeBase(destRef, sourceRef);
  if (!mergeBase) {
    core.debug("No common history found between branches");
    return { isModified: false, details: "No common history" };
  }

  // Check if destination has commits that source doesn't have
  // This happens when: destination !== merge-base (destination is ahead of merge-base)
  const destIsModified = destCommit !== mergeBase;

  const details = destIsModified
    ? `Destination has diverged: dest=${destCommit.substring(0, 7)}, merge-base=${mergeBase.substring(0, 7)}`
    : `Destination is clean: dest=${destCommit.substring(0, 7)}, merge-base=${mergeBase.substring(0, 7)}`;

  core.debug(`Destination modification check: ${details}`);
  return { isModified: destIsModified, details };
}

/**
 * Check if source branch has only new commits ahead of destination
 * @param {string} destRef - Destination ref (e.g., origin/main)
 * @param {string} sourceRef - Source ref (e.g., source/main)
 * @returns {Promise<boolean>} True if safe to push without force
 */
async function isSourceAheadOfDestination(destRef, sourceRef) {
  const destCommit = await getRefCommit(destRef);
  if (!destCommit) {
    core.debug(`Destination ref ${destRef} does not exist`);
    return true; // New branch, can push
  }

  const sourceCommit = await getRefCommit(sourceRef);
  if (!sourceCommit) {
    core.debug(`Source ref ${sourceRef} does not exist`);
    return false; // Source doesn't exist, nothing to push
  }

  const mergeBase = await getMergeBase(destRef, sourceRef);
  if (!mergeBase) {
    // No common history - branches are completely independent
    // This can happen when destination branch was created independently (e.g., with initial README)
    // In this case, we need force push to replace it
    core.debug(
      `No common history between ${destRef} and ${sourceRef}. Will need force push.`,
    );
    return false; // Return false to trigger force push in caller
  }

  // Check if source is ahead of destination
  // Source is ahead if:
  // 1. Destination is the merge base (destination is ancestor of source)
  // 2. Source commit is different from destination commit (source has new commits)
  const isAhead = mergeBase === destCommit && sourceCommit !== destCommit;
  core.debug(
    `Branch comparison: merge-base=${mergeBase.substring(0, 7)}, dest=${destCommit.substring(0, 7)}, source=${sourceCommit.substring(0, 7)}, source-ahead=${isAhead}`,
  );
  return isAhead;
}

async function syncBranches(
  sourceBranch,
  destinationBranch,
  syncAllBranches,
  useMainAsFallback,
) {
  if (syncAllBranches) {
    core.info("=== Syncing All Branches ===");

    const sourceBranchNames = await getSourceBranches();
    core.info(`Found ${sourceBranchNames.length} branches in source to sync`);

    // Create branch mapping: by default, branch names stay the same
    // But the specified source_branch maps to destination_branch
    const branchMapping = {};
    for (const branch of sourceBranchNames) {
      branchMapping[branch] = (branch === sourceBranch) ? destinationBranch : branch;
    }
    
    core.info(`Branch mapping: ${JSON.stringify(branchMapping)}`);

    // Get all destination branches (excluding HEAD)
    let stdout = "";
    await exec.exec("git", ["branch", "-r"], {
      listeners: {
        stdout: (data) => {
          stdout += data.toString();
        },
      },
    });

    const destinationBranches = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.includes("HEAD") && line.startsWith("origin/"))
      .map((line) => line.replace("origin/", ""));

    core.info(`Found ${destinationBranches.length} branches in destination`);

    // Build list of expected destination branches based on mapping
    const expectedDestinationBranches = Object.values(branchMapping);
    
    // Delete destination branches that don't exist in source
    const branchesToDelete = destinationBranches.filter(
      (branch) => !expectedDestinationBranches.includes(branch),
    );

    if (branchesToDelete.length > 0) {
      core.info(`Deleting ${branchesToDelete.length} destination-only branches...`);
      for (const branch of branchesToDelete) {
        try {
          core.info(`Deleting branch: ${branch}`);
          await exec.exec("git", ["push", "origin", `--delete`, branch]);
          core.info(`✓ Branch deleted: ${branch}`);
        } catch (error) {
          core.warning(`Could not delete branch ${branch}: ${error.message}`);
        }
      }
    } else {
      core.info("No destination-only branches to delete");
    }

    // Push all source branches to destination (using the mapping)
    for (const sourceBranchName of sourceBranchNames) {
      const destBranchName = branchMapping[sourceBranchName];
      core.info(`Syncing branch: ${sourceBranchName} → ${destBranchName}`);

      const destRef = `origin/${destBranchName}`;
      const sourceRef = `source/${sourceBranchName}`;

      // FIRST: Check if destination has been modified
      const modCheck = await hasDestinationBeenModified(destRef, sourceRef);
      if (modCheck.isModified) {
        const destCommit = await getRefCommit(destRef);
        core.error(
          `❌ SYNC BLOCKED: Destination branch "${destBranchName}" has been modified since last sync.`,
        );
        core.error(
          `   The destination contains commits that don't exist in the source.`,
        );
        core.error(`   Details: ${modCheck.details}`);
        core.error(
          `   To resolve this, manually merge or rebase the destination changes.`,
        );
        throw new Error(
          `Destination branch "${destBranchName}" has been modified. Manual intervention required.`,
        );
      }

      // SECOND: Check if source has new commits to push
      const isAhead = await isSourceAheadOfDestination(destRef, sourceRef);

      if (isAhead) {
        // Source has only new commits, can push without force
        core.info(`✓ Destination is clean, source is ahead. Pushing new commits...`);
        try {
          await exec.exec("git", [
            "push",
            "origin",
            `refs/remotes/source/${sourceBranchName}:refs/heads/${destBranchName}`,
          ]);
          core.info(`✓ Branch synced: ${sourceBranchName} → ${destBranchName}`);
        } catch (error) {
          core.error(`Failed to push ${sourceBranchName} → ${destBranchName}: ${error.message}`);
          throw error;
        }
      } else {
        // Destination doesn't exist yet (new branch) OR
        // Destination exists but has no common history with source (e.g., master → main rename)
        const destCommit = await getRefCommit(destRef);
        if (!destCommit) {
          core.info(`${destBranchName} is a new branch, pushing with force...`);
          await exec.exec("git", [
            "push",
            "origin",
            `refs/remotes/source/${sourceBranchName}:refs/heads/${destBranchName}`,
            "--force",
          ]);
          core.info(`✓ Branch synced: ${sourceBranchName} → ${destBranchName}`);
        } else {
          // Destination exists but has no common history - this can happen with branch renames
          // Safe to force push since we already verified the destination hasn't been modified
          core.info(
            `Destination branch has no common history with source, pushing with force to replace...`,
          );
          await exec.exec("git", [
            "push",
            "origin",
            `refs/remotes/source/${sourceBranchName}:refs/heads/${destBranchName}`,
            "--force",
          ]);
          core.info(`✓ Branch synced: ${sourceBranchName} → ${destBranchName}`);
        }
      }
    }
  } else {
    core.info("=== Syncing Single Branch ===");

    // Check available branches first
    const availableBranches = await getSourceBranches();
    let actualSourceBranch = sourceBranch;

    if (!availableBranches.includes(sourceBranch)) {
      if (useMainAsFallback) {
        core.warning(
          `Branch "${sourceBranch}" not found. Trying main or master...`,
        );
        const fallbackBranch = await getTryFallbackBranch(availableBranches);

        if (fallbackBranch) {
          actualSourceBranch = fallbackBranch;
          core.info(`✓ Using fallback branch: ${fallbackBranch}`);
        } else {
          throw new Error(
            `Branch "${sourceBranch}" not found, and no fallback (main/master) available. Available branches: ${availableBranches.join(", ") || "none"}`,
          );
        }
      } else {
        throw new Error(
          `Branch "${sourceBranch}" not found in source repository. Available branches: ${availableBranches.join(", ") || "none"}`,
        );
      }
    }

    core.info(`Syncing branch: ${actualSourceBranch} → ${destinationBranch}`);

    const destRef = `origin/${destinationBranch}`;
    const sourceRef = `source/${actualSourceBranch}`;

    // FIRST: Check if destination has been modified
    const modCheck = await hasDestinationBeenModified(destRef, sourceRef);
    if (modCheck.isModified) {
      const destCommit = await getRefCommit(destRef);
      core.error(
        `❌ SYNC BLOCKED: Destination branch "${destinationBranch}" has been modified since last sync.`,
      );
      core.error(
        `   The destination contains commits that don't exist in the source.`,
      );
      core.error(`   Details: ${modCheck.details}`);
      core.error(
        `   To resolve this, manually merge or rebase the destination changes.`,
      );
      throw new Error(
        `Destination branch "${destinationBranch}" has been modified. Manual intervention required.`,
      );
    }

    // SECOND: Check if source has new commits to push
    const isAhead = await isSourceAheadOfDestination(destRef, sourceRef);

    if (isAhead) {
      // Source has only new commits, can push without force
      core.info(`✓ Destination is clean, source is ahead. Pushing new commits...`);
      try {
        await exec.exec("git", [
          "push",
          "origin",
          `refs/remotes/source/${actualSourceBranch}:refs/heads/${destinationBranch}`,
        ]);
        core.info(`✓ Branch synced: ${actualSourceBranch} → ${destinationBranch}`);
      } catch (error) {
        core.error(`Failed to push: ${error.message}`);
        throw error;
      }
    } else {
      // Destination doesn't exist yet (new branch) OR
      // Destination exists but has no common history with source (e.g., master → main rename)
      const destCommit = await getRefCommit(destRef);
      if (!destCommit) {
        core.info(`Destination branch does not exist, pushing with force...`);
        await exec.exec("git", [
          "push",
          "origin",
          `refs/remotes/source/${actualSourceBranch}:refs/heads/${destinationBranch}`,
          "--force",
        ]);
        core.info(`✓ Branch synced: ${actualSourceBranch} → ${destinationBranch}`);
      } else {
        // Destination exists but has no common history - this can happen with branch renames
        // Safe to force push since we already verified the destination hasn't been modified
        core.info(
          `Destination branch has no common history with source, pushing with force to replace...`,
        );
        await exec.exec("git", [
          "push",
          "origin",
          `refs/remotes/source/${actualSourceBranch}:refs/heads/${destinationBranch}`,
          "--force",
        ]);
        core.info(`✓ Branch synced: ${actualSourceBranch} → ${destinationBranch}`);
      }
    }
  }
}

async function syncTags(syncTags) {
  if (syncTags === "true") {
    core.info("=== Syncing All Tags ===");
    core.info("Fetching tags...");
    await exec.exec("git", ["fetch", "source", "--tags"]);
    core.info("✓ Tags fetched");

    core.info("Pushing tags without force...");
    try {
      await exec.exec("git", ["push", "origin", "--tags"]);
      core.info("✓ Tags pushed");
    } catch (error) {
      core.warning(
        `⚠ Tag push failed (may have conflicting tags), retrying with force: ${error.message}`,
      );
      await exec.exec("git", ["push", "origin", "--tags", "--force"]);
      core.info("✓ Tags pushed (with force)");
    }
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
        try {
          await exec.exec("git", [
            "push",
            "origin",
            `refs/tags/${tag}:refs/tags/${tag}`,
          ]);
          core.info(`✓ Tag pushed: ${tag}`);
        } catch (error) {
          core.warning(
            `⚠ Tag push failed (may be conflicting), retrying with force: ${tag}`,
          );
          await exec.exec("git", [
            "push",
            "origin",
            `refs/tags/${tag}:refs/tags/${tag}`,
            "--force",
          ]);
          core.info(`✓ Tag pushed (with force): ${tag}`);
        }
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

    // Validate authentication configuration early
    const authValidation = validateAuthentication(inputs);
    if (!authValidation.isValid) {
      logValidationResult(authValidation);
      throw new Error("Authentication configuration is invalid. See errors above.");
    }
    if (authValidation.warnings.length > 0) {
      logValidationResult(authValidation);
    }

    // Setup SSH authentication if needed
    const authMethods = detectAuthenticationMethods(inputs.sourceRepo, inputs.destinationRepo);
    if (authMethods.needsSSH) {
      const sshConfig = {
        sshKey: inputs.sshKey,
        sshKeyPath: inputs.sshKeyPath,
        sshPassphrase: inputs.sshPassphrase,
        sshKnownHostsPath: inputs.sshKnownHostsPath,
        sshStrictHostKeyChecking: inputs.sshStrictHostKeyChecking,
      };
      
      // Collect SSH hosts to validate
      const hostsToValidate = [];
      if (authMethods.sourceIsSSH) {
        const sourceHost = extractSSHHostname(inputs.sourceRepo);
        if (sourceHost) hostsToValidate.push(sourceHost);
      }
      if (authMethods.destinationIsSSH) {
        const destHost = extractSSHHostname(inputs.destinationRepo);
        if (destHost) hostsToValidate.push(destHost);
      }
      // Fallback to github.com if no SSH hosts found (shouldn't happen, but defensive)
      if (hostsToValidate.length === 0) {
        hostsToValidate.push("github.com");
      }
      
      await setupSSHAuthentication(sshConfig, hostsToValidate);
    }

    // Detect if destination is Gerrit
    const isDestinationGerrit = isGerritRepository(inputs.destinationRepo);

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

    // Use Gerrit-specific or standard sync based on detection
    if (isDestinationGerrit) {
      logGerritInfo(inputs.sourceRepo, inputs.destinationRepo);
      await syncBranchesGerrit(
        inputs.sourceBranch,
        inputs.destinationBranch,
        inputs.syncAllBranches,
        inputs.useMainAsFallback,
      );
      await syncTagsGerrit(inputs.syncTags);
    } else {
      await syncBranches(
        inputs.sourceBranch,
        inputs.destinationBranch,
        inputs.syncAllBranches,
        inputs.useMainAsFallback,
      );
      await syncTags(inputs.syncTags);
    }

    core.info("=== GitHub Sync Completed Successfully ===");
    core.info("Sync complete!");
  } catch (error) {
    core.error("=== GitHub Sync Failed ===");
    core.setFailed(error.message);
  }
}

run();
