import * as core from "@actions/core";
import simpleGit from "simple-git";
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

async function run() {
  try {
    core.info("=== GitHub Sync Action Started ===");
    
    const sourceRepo = core.getInput("source_repo", { required: true });
    const sourceBranch = core.getInput("source_branch", { required: true });
    const destinationRepo = core.getInput("destination_repo", {
      required: true,
    });
    const destinationBranch = core.getInput("destination_branch", {
      required: true,
    });
    const syncTags = core.getInput("sync_tags");
    const sourceToken = core.getInput("source_token");
    const syncAllBranches = core.getInput("sync_all_branches") === "true";

    core.info(`Source: ${sourceRepo} (branch: ${sourceBranch})`);
    core.info(`Destination: ${destinationRepo} (branch: ${destinationBranch})`);
    core.info(`Sync all branches: ${syncAllBranches}`);
    core.info(`Sync tags: ${syncTags || "false"}`);

    // Authentication: GitHub App or PAT
    const githubAppId = core.getInput("github_app_id");
    const githubAppPrivateKey = core.getInput("github_app_private_key");
    const githubAppInstallationId = core.getInput("github_app_installation_id");
    const githubToken = core.getInput("github_token");

    let destinationToken;

    if (githubToken) {
      // Use PAT if provided
      core.info("Using GitHub Personal Access Token for authentication...");
      destinationToken = githubToken;
    } else if (githubAppId && githubAppPrivateKey && githubAppInstallationId) {
      // Use GitHub App if all credentials provided
      core.info("Authenticating as GitHub App installation...");
      destinationToken = await getAppInstallationToken(
        githubAppId,
        githubAppPrivateKey,
        githubAppInstallationId,
      );
      core.info("GitHub App token obtained successfully");
    } else {
      throw new Error(
        "Either github_token (PAT) or github_app credentials (app_id, private_key, installation_id) must be provided",
      );
    }

    // Prepare source and destination URLs
    let srcUrl = sourceRepo;
    let dstUrl = destinationRepo;

    core.info("=== Setting up Git Configuration ===");
    
    // Create git instance
    const git = simpleGit();
    
    // Configure git user
    core.info("Configuring git user...");
    await git.addConfig("user.name", "github-sync-action");
    await git.addConfig("user.email", "github-sync@github.com");
    core.info("Git user configured");
    
    // Configure git to not prompt for credentials
    await git.addConfig("core.askPass", "true");
    
    // Use credential helper to store credentials temporarily
    // This is more reliable than embedding in URL
    if (destinationToken && dstUrl.startsWith("https://")) {
      // Parse the URL to get the host
      try {
        const urlObj = new URL(dstUrl);
        const host = urlObj.hostname;
        
        // Store credentials in git's credential cache
        await git.raw([
          "credential",
          "approve"
        ]).then((result) => {
          // This won't work directly, let's use a different approach
        }).catch(() => {
          // Continue even if credential approve fails
        });
      } catch (error) {
        core.debug(`Could not configure credentials: ${error.message}`);
      }
    }
    
    core.info("=== Preparing URLs with Authentication ===");
    
    // Embed credentials in URL as final approach
    if (destinationToken && dstUrl.startsWith("https://")) {
      // Use x-access-token as username and token as password
      dstUrl = dstUrl.replace("https://", `https://x-access-token:${destinationToken}@`);
      core.info("✓ Destination URL prepared with authentication");
      core.debug(`Destination URL: ${dstUrl.replace(/x-access-token:.*@/, "x-access-token:***@")}`);
    }
    
    if (sourceToken && srcUrl.startsWith("https://")) {
      srcUrl = srcUrl.replace("https://", `https://x-access-token:${sourceToken}@`);
      core.info("✓ Source URL prepared with authentication");
      core.debug(`Source URL: ${srcUrl.replace(/x-access-token:.*@/, "x-access-token:***@")}`);
    } else if (!sourceToken && srcUrl.startsWith("https://")) {
      core.info("ℹ Source repo is public (no token provided)");
    }
    
    // Clone destination repo
    core.info("=== Cloning Destination Repository ===");
    core.info(`Cloning: ${dstUrl.replace(/x-access-token:.*@/, "x-access-token:***@")}`);
    try {
      await git.clone(dstUrl, "repo");
      core.info("✓ Destination repository cloned successfully");
    } catch (error) {
      core.error(`✗ Clone failed: ${error.message}`);
      throw error;
    }

    const repo = simpleGit("repo");
    core.info("Git repository initialized");

    // Add source as remote (if not already)
    core.info("=== Setting up Source Remote ===");
    const remotes = await repo.getRemotes(true);
    const sourceRemoteExists = remotes.some((r) => r.name === "source");

    if (!sourceRemoteExists) {
      core.info("Adding source remote...");
      await repo.addRemote("source", srcUrl);
      core.info("✓ Source remote added");
    } else {
      core.info("Updating existing source remote...");
      await repo.removeRemote("source");
      await repo.addRemote("source", srcUrl);
      core.info("✓ Source remote updated");
    }
    
    core.info("Fetching from source...");
    await repo.fetch("source");
    core.info("✓ Fetch from source completed");

    if (syncAllBranches) {
      // Get all remote branches from source
      core.info("=== Syncing All Branches ===");
      const branches = await repo.branch(["-r"]);
      const branchNames = branches.all
        .filter((b) => b.startsWith("source/") && !b.includes("->"))
        .map((b) => b.replace("source/", ""));

      core.info(`Found ${branchNames.length} branches to sync`);
      
      for (const branch of branchNames) {
        core.info(`Syncing branch: ${branch}`);
        await repo.push(
          "origin",
          `refs/remotes/source/${branch}:refs/heads/${branch}`,
          { "--force": null },
        );
        core.info(`✓ Branch synced: ${branch}`);
      }
    } else {
      // Fetch and sync only the specified branch
      core.info("=== Syncing Single Branch ===");
      core.info(`Fetching branch: ${sourceBranch}`);
      await repo.fetch("source", sourceBranch);
      core.info(`✓ Fetched: ${sourceBranch}`);
      
      core.info(`Pushing to: ${destinationBranch}`);
      await repo.push(
        "origin",
        `refs/remotes/source/${sourceBranch}:refs/heads/${destinationBranch}`,
        { "--force": null },
      );
      core.info(`✓ Pushed to: ${destinationBranch}`);
    }

    // Sync tags if requested
    if (syncTags === "true") {
      core.info("=== Syncing All Tags ===");
      core.info("Fetching tags...");
      await repo.fetch("source", "--tags");
      core.info("✓ Tags fetched");
      
      core.info("Pushing tags...");
      await repo.pushTags("origin", { "--force": null });
      core.info("✓ Tags pushed");
    } else if (syncTags) {
      core.info("=== Syncing Tags Matching Pattern ===");
      core.info(`Pattern: ${syncTags}`);
      
      core.info("Fetching tags...");
      await repo.fetch("source", "--tags");
      core.info("✓ Tags fetched");
      
      // Filter and push tags matching pattern
      const allTags = await repo.tags();
      const matchingTags = allTags.all.filter((tag) => tag.match(syncTags));
      
      core.info(`Found ${matchingTags.length} matching tags`);
      
      for (const tag of matchingTags) {
        if (tag) {
          core.info(`Pushing tag: ${tag}`);
          await repo.push("origin", `refs/tags/${tag}:refs/tags/${tag}`, {
            "--force": null,
          });
          core.info(`✓ Tag pushed: ${tag}`);
        }
      }
    } else {
      core.info("Tag syncing disabled");
    }

    core.info("=== GitHub Sync Completed Successfully ===");
    core.info("Sync complete!");
  } catch (error) {
    core.error("=== GitHub Sync Failed ===");
    core.setFailed(error.message);
  }
}

run();
