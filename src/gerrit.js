import * as core from "@actions/core";
import * as exec from "@actions/exec";

/**
 * Gerrit-specific repository synchronization module
 * Handles Gerrit-specific push workflows and configurations
 */

/**
 * Detect if a repository is Gerrit-based by checking for gerrit-specific patterns
 * Uses Option 2: URL-based detection for fast, automatic classification
 */
export function isGerritRepository(repoUrl) {
  core.info("=== Detecting Repository Type ===");
  core.debug(`Checking URL: ${repoUrl}`);

  // Common Gerrit URL patterns
  const gerritPatterns = [
    /gerrit/i, // Contains "gerrit" in domain or path
    /:29418/, // Gerrit SSH default port
    /\/r\//, // Gerrit review path pattern
  ];

  const isGerrit = gerritPatterns.some((pattern) => pattern.test(repoUrl));

  if (isGerrit) {
    core.info("✓ Gerrit repository detected");
  } else {
    core.info("✓ Standard Git repository detected (GitHub, GitLab, Gitea, etc.)");
  }

  return isGerrit;
}

/**
 * Gerrit-specific branch sync using refs/for/* reference
 * This allows pushes to go to Gerrit's review queue instead of direct branch push
 */
export async function syncBranchesGerrit(
  sourceBranch,
  destinationBranch,
  syncAllBranches,
  useMainAsFallback,
) {
  if (syncAllBranches) {
    core.info("=== Syncing All Branches to Gerrit (Review Queue) ===");

    const branchNames = await getSourceBranchesGerrit();
    core.info(`Found ${branchNames.length} branches to sync`);

    for (const branch of branchNames) {
      core.info(`Syncing branch to Gerrit: ${branch}`);
      try {
        // Push to refs/for/* instead of refs/heads/*
        // This creates a change/review in Gerrit instead of direct push
        await exec.exec("git", [
          "push",
          "origin",
          `refs/remotes/source/${branch}:refs/for/${branch}`,
          "--force",
        ]);
        core.info(`✓ Branch synced to Gerrit review queue: ${branch}`);
      } catch (error) {
        core.warning(
          `⚠ Failed to sync ${branch} to Gerrit review: ${error.message}`,
        );
        // Continue with other branches even if one fails
      }
    }
  } else {
    core.info("=== Syncing Single Branch to Gerrit (Review Queue) ===");

    const availableBranches = await getSourceBranchesGerrit();
    let actualSourceBranch = sourceBranch;

    if (!availableBranches.includes(sourceBranch)) {
      if (useMainAsFallback) {
        core.warning(
          `Branch "${sourceBranch}" not found. Trying main or master...`,
        );
        const fallbackBranch = await getTryFallbackBranchGerrit(
          availableBranches,
        );

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

    core.info(
      `Syncing branch to Gerrit review queue: ${actualSourceBranch} → ${destinationBranch}`,
    );
    await exec.exec("git", [
      "push",
      "origin",
      `refs/remotes/source/${actualSourceBranch}:refs/for/${destinationBranch}`,
      "--force",
    ]);
    core.info(
      `✓ Branch synced to Gerrit: ${actualSourceBranch} → ${destinationBranch}`,
    );
  }
}

/**
 * Get available branches from source remote (Gerrit-specific)
 */
async function getSourceBranchesGerrit() {
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
    .filter(
      (line) =>
        line.startsWith("source/") &&
        !line.includes("->") &&
        !line.includes("refs/for/") &&
        !line.includes("refs/changes/"),
    ) // Exclude Gerrit special refs
    .map((line) => line.replace("source/", ""));

  return branchNames;
}

/**
 * Try to find a fallback branch (Gerrit-specific)
 */
async function getTryFallbackBranchGerrit(availableBranches) {
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
 * Gerrit-specific tag sync
 * Note: Gerrit may have different tag handling than standard Git
 */
export async function syncTagsGerrit(syncTags) {
  if (syncTags === "true") {
    core.info("=== Syncing All Tags to Gerrit ===");
    core.info("Fetching tags...");
    try {
      await exec.exec("git", ["fetch", "source", "--tags"]);
      core.info("✓ Tags fetched");

      core.info("Pushing tags to Gerrit...");
      await exec.exec("git", ["push", "origin", "--tags", "--force"]);
      core.info("✓ Tags pushed to Gerrit");
    } catch (error) {
      core.warning(`⚠ Tag sync failed: ${error.message}`);
    }
  } else if (syncTags) {
    core.info("=== Syncing Tags Matching Pattern to Gerrit ===");
    core.info(`Pattern: ${syncTags}`);

    core.info("Fetching tags...");
    try {
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
          core.info(`Pushing tag to Gerrit: ${tag}`);
          await exec.exec("git", [
            "push",
            "origin",
            `refs/tags/${tag}:refs/tags/${tag}`,
            "--force",
          ]);
          core.info(`✓ Tag pushed to Gerrit: ${tag}`);
        }
      }
    } catch (error) {
      core.warning(`⚠ Tag sync failed: ${error.message}`);
    }
  } else {
    core.info("Tag syncing disabled");
  }
}

/**
 * Log Gerrit-specific information
 */
export function logGerritInfo(sourceRepo, destinationRepo) {
  core.info("=== Gerrit Sync Configuration ===");
  core.info(`Source: ${sourceRepo}`);
  core.info(`Destination: ${destinationRepo}`);
  core.info("Push Reference: refs/for/* (Gerrit review queue)");
  core.info("Note: Changes will be created in Gerrit review queue");
}
