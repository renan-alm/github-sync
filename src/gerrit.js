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
 * Calculate merge base between destination and source branches
 * @param {string} destBranch - Destination branch (e.g., origin/main)
 * @param {string} sourceBranch - Source branch (e.g., source/main)
 * @returns {Promise<string|null>} Merge base commit hash or null if no common history
 */
async function getMergeBaseGerrit(destBranch, sourceBranch) {
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
async function getRefCommitGerrit(ref) {
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
async function hasDestinationBeenModifiedGerrit(destRef, sourceRef) {
  // FIRST: Check if destination and source refs exist (before merge-base to avoid errors)
  const sourceCommit = await getRefCommitGerrit(sourceRef);
  const destCommit = await getRefCommitGerrit(destRef);

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
  const mergeBase = await getMergeBaseGerrit(destRef, sourceRef);
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
async function isSourceAheadOfDestinationGerrit(destRef, sourceRef) {
  const destCommit = await getRefCommitGerrit(destRef);
  if (!destCommit) {
    core.debug(`Destination ref ${destRef} does not exist`);
    return true; // New branch, can push
  }

  const sourceCommit = await getRefCommitGerrit(sourceRef);
  if (!sourceCommit) {
    core.debug(`Source ref ${sourceRef} does not exist`);
    return false; // Source doesn't exist, nothing to push
  }

  const mergeBase = await getMergeBaseGerrit(destRef, sourceRef);
  if (!mergeBase) {
    // No common history - branches are completely independent
    // This can happen when destination branch was created independently
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

    const sourceBranchNames = await getSourceBranchesGerrit();
    core.info(`Found ${sourceBranchNames.length} branches to sync`);

    // Create branch mapping: by default, branch names stay the same
    // But the specified source_branch maps to destination_branch
    const branchMapping = {};
    for (const branch of sourceBranchNames) {
      branchMapping[branch] = (branch === sourceBranch) ? destinationBranch : branch;
    }
    
    core.info(`Branch mapping: ${JSON.stringify(branchMapping)}`);

    for (const sourceBranchName of sourceBranchNames) {
      const destBranchName = branchMapping[sourceBranchName];
      core.info(`Syncing branch to Gerrit: ${sourceBranchName} → ${destBranchName}`);
      try {
        const destRef = `origin/${destBranchName}`;
        const sourceRef = `source/${sourceBranchName}`;

        // FIRST: Check if destination has been modified
        const modCheck = await hasDestinationBeenModifiedGerrit(destRef, sourceRef);
        if (modCheck.isModified) {
          const destCommit = await getRefCommitGerrit(destRef);
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
        const isAhead = await isSourceAheadOfDestinationGerrit(destRef, sourceRef);

        if (isAhead) {
          // Source has only new commits, push to review queue without force
          core.info(
            `✓ Destination is clean, source is ahead. Pushing to Gerrit review queue...`,
          );
          await exec.exec("git", [
            "push",
            "origin",
            `refs/remotes/source/${sourceBranchName}:refs/for/${destBranchName}`,
          ]);
          core.info(`✓ Branch synced to Gerrit review queue: ${sourceBranchName} → ${destBranchName}`);
        } else {
          // Destination doesn't exist yet (new branch) OR
          // Destination exists but has no common history with source (e.g., master → main rename)
          const destCommit = await getRefCommitGerrit(destRef);
          if (!destCommit) {
            // New branch, safe to push with force
            core.info(`${destBranchName} is a new branch, pushing to Gerrit with force...`);
            await exec.exec("git", [
              "push",
              "origin",
              `refs/remotes/source/${sourceBranchName}:refs/for/${destBranchName}`,
              "--force",
            ]);
            core.info(`✓ Branch synced to Gerrit review queue: ${sourceBranchName} → ${destBranchName}`);
          } else {
            // Destination exists but has no common history - this can happen with branch renames
            // Safe to force push since we already verified the destination hasn't been modified
            core.info(
              `Destination branch has no common history with source, pushing to Gerrit with force...`,
            );
            await exec.exec("git", [
              "push",
              "origin",
              `refs/remotes/source/${sourceBranchName}:refs/for/${destBranchName}`,
              "--force",
            ]);
            core.info(`✓ Branch synced to Gerrit review queue: ${sourceBranchName} → ${destBranchName}`);
          }
        }
      } catch (error) {
        core.error(`❌ Failed to sync ${sourceBranchName} → ${destBranchName}: ${error.message}`);
        throw error; // Fail the entire action on first branch error
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

    const destRef = `origin/${destinationBranch}`;
    const sourceRef = `source/${actualSourceBranch}`;

    // FIRST: Check if destination has been modified
    const modCheck = await hasDestinationBeenModifiedGerrit(destRef, sourceRef);
    if (modCheck.isModified) {
      const destCommit = await getRefCommitGerrit(destRef);
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
    const isAhead = await isSourceAheadOfDestinationGerrit(destRef, sourceRef);

    if (isAhead) {
      // Source has only new commits, push to review queue without force
      core.info(
        `✓ Destination is clean, source is ahead. Pushing to Gerrit review queue...`,
      );
      await exec.exec("git", [
        "push",
        "origin",
        `refs/remotes/source/${actualSourceBranch}:refs/for/${destinationBranch}`,
      ]);
      core.info(
        `✓ Branch synced to Gerrit: ${actualSourceBranch} → ${destinationBranch}`,
      );
    } else {
      // Destination doesn't exist yet (new branch)
      const destCommit = await getRefCommitGerrit(destRef);
      if (!destCommit) {
        // New branch, safe to push with force
        core.info(
          `Destination branch does not exist, pushing to Gerrit with force...`,
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
      } else {
        // Destination doesn't exist yet (new branch) OR
        // Destination exists but has no common history with source (e.g., master → main rename)
        const destCommit = await getRefCommitGerrit(destRef);
        if (!destCommit) {
          // New branch, safe to push with force
          core.info(
            `Destination branch does not exist, pushing to Gerrit with force...`,
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
        } else {
          // Destination exists but has no common history - this can happen with branch renames
          // Safe to force push since we already verified the destination hasn't been modified
          core.info(
            `Destination branch has no common history with source, pushing to Gerrit with force...`,
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
    }
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

      core.info("Pushing tags to Gerrit without force...");
      try {
        await exec.exec("git", ["push", "origin", "--tags"]);
        core.info("✓ Tags pushed to Gerrit");
      } catch (error) {
        core.warning(
          `⚠ Tag push failed (may have conflicting tags), retrying with force: ${error.message}`,
        );
        await exec.exec("git", ["push", "origin", "--tags", "--force"]);
        core.info("✓ Tags pushed to Gerrit (with force)");
      }
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
          try {
            await exec.exec("git", [
              "push",
              "origin",
              `refs/tags/${tag}:refs/tags/${tag}`,
            ]);
            core.info(`✓ Tag pushed to Gerrit: ${tag}`);
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
            core.info(`✓ Tag pushed to Gerrit (with force): ${tag}`);
          }
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
