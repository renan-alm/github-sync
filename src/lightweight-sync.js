import * as core from "@actions/core";
import * as exec from "@actions/exec";

/**
 * Lightweight sync for large repositories
 * Uses the source remote that's already configured
 * Much faster for large repositories since it doesn't need full git history.
 * Approach: Fetch from source remote and force push to destination
 */
export async function syncBranchesLightweight(
  sourceBranch,
  destinationBranch,
  syncAllBranches,
) {
  core.info("=== Starting Lightweight Sync (Large Repository Mode) ===");
  core.info(
    `Using lightweight approach - optimized for large repositories`,
  );

  if (syncAllBranches) {
    core.info("=== Syncing All Branches (Lightweight) ===");

    // Get all source branches
    let sourceBranchesOutput = "";
    await exec.exec("git", ["branch", "-r", "--list", "source/*"], {
      listeners: {
        stdout: (data) => {
          sourceBranchesOutput += data.toString();
        },
      },
    });

    const sourceBranches = sourceBranchesOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.includes("HEAD"))
      .map((line) => line.replace("source/", ""));

    core.info(`Found ${sourceBranches.length} source branches`);

    // Create branch mapping: source_branch → destination_branch, others keep same name
    const branchMapping = {};
    for (const branch of sourceBranches) {
      branchMapping[branch] =
        branch === sourceBranch ? destinationBranch : branch;
    }

    core.info(`Branch mapping: ${JSON.stringify(branchMapping)}`);

    // Push all branches
    for (const sourceBranchName of sourceBranches) {
      const destBranchName = branchMapping[sourceBranchName];
      core.info(`Pushing: ${sourceBranchName} → ${destBranchName}`);

      try {
        await exec.exec("git", [
          "push",
          "origin",
          `refs/remotes/source/${sourceBranchName}:refs/heads/${destBranchName}`,
          "--force",
        ]);
        core.info(`✓ Branch pushed: ${sourceBranchName} → ${destBranchName}`);
      } catch (error) {
        core.error(
          `Failed to push ${sourceBranchName} → ${destBranchName}: ${error.message}`,
        );
        throw error;
      }
    }
  } else {
    core.info(`=== Syncing Single Branch (Lightweight) ===`);
    core.info(`Pushing: ${sourceBranch} → ${destinationBranch}`);

    try {
      await exec.exec("git", [
        "push",
        "origin",
        `refs/remotes/source/${sourceBranch}:refs/heads/${destinationBranch}`,
        "--force",
      ]);
      core.info(
        `✓ Branch pushed: ${sourceBranch} → ${destinationBranch}`,
      );
    } catch (error) {
      core.error(
        `Failed to push ${sourceBranch} → ${destinationBranch}: ${error.message}`,
      );
      throw error;
    }
  }
}

/**
 * Lightweight tag sync for large repositories
 * Uses direct git tag commands for efficiency
 * Fetches tags from source and pushes to destination with --force
 */
export async function syncTagsLightweight(syncTags) {
  if (syncTags === "true") {
    core.info("=== Syncing All Tags (Lightweight) ===");

    try {
      // Delete all local tags to ensure clean state (matching inspiration.sh behavior)
      core.info("Cleaning up local tags...");
      let tagsOutput = "";
      await exec.exec("git", ["tag", "-l"], {
        listeners: {
          stdout: (data) => {
            tagsOutput += data.toString();
          },
        },
      });
      
      if (tagsOutput.trim()) {
        const tags = tagsOutput.split(/\r?\n/).filter((tag) => tag.trim());
        for (const tag of tags) {
          if (tag) {
            await exec.exec("git", ["tag", "-d", tag], {
              silent: true,
            });
          }
        }
        core.info(`✓ Deleted ${tags.length} local tags`);
      }

      // Fetch all tags from source
      core.info("Fetching tags from source...");
      await exec.exec("git", ["fetch", "source", "--tags", "--quiet"]);

      // Push all tags to destination
      core.info("Pushing all tags to destination...");
      await exec.exec("git", ["push", "origin", "--tags", "--force"]);
      core.info("✓ All tags synced");
    } catch (error) {
      core.error(`Failed to sync tags: ${error.message}`);
      throw error;
    }
  } else if (syncTags) {
    core.info("=== Syncing Tags Matching Pattern (Lightweight) ===");
    core.info(`Pattern: ${syncTags}`);

    try {
      // Delete all local tags to ensure clean state (matching inspiration.sh behavior)
      core.info("Cleaning up local tags...");
      let tagsOutput = "";
      await exec.exec("git", ["tag", "-l"], {
        listeners: {
          stdout: (data) => {
            tagsOutput += data.toString();
          },
        },
      });
      
      if (tagsOutput.trim()) {
        const tags = tagsOutput.split(/\r?\n/).filter((tag) => tag.trim());
        for (const tag of tags) {
          if (tag) {
            await exec.exec("git", ["tag", "-d", tag], {
              silent: true,
            });
          }
        }
        core.info(`✓ Deleted ${tags.length} local tags`);
      }

      // Fetch all tags
      core.info("Fetching tags from source...");
      await exec.exec("git", ["fetch", "source", "--tags", "--quiet"]);

      // Get all tags
      let allTagsOutput = "";
      await exec.exec("git", ["tag"], {
        listeners: {
          stdout: (data) => {
            allTagsOutput += data.toString();
          },
        },
      });

      const allTags = allTagsOutput
        .split(/\r?\n/)
        .filter((tag) => tag.trim());
      const matchingTags = allTags.filter((tag) => tag.match(syncTags));

      core.info(`Found ${matchingTags.length} matching tags`);

      // Push matching tags
      for (const tag of matchingTags) {
        if (tag) {
          try {
            core.info(`Pushing tag: ${tag}`);
            await exec.exec("git", [
              "push",
              "origin",
              `refs/tags/${tag}:refs/tags/${tag}`,
              "--force",
            ]);
            core.info(`✓ Tag pushed: ${tag}`);
          } catch (error) {
            core.warning(`Failed to push tag ${tag}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      core.error(`Failed to sync tags: ${error.message}`);
      throw error;
    }
  } else {
    core.info("Tag syncing disabled");
  }
}
