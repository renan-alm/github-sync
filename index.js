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
    } else {
      throw new Error(
        "Either github_token (PAT) or github_app credentials (app_id, private_key, installation_id) must be provided",
      );
    }

    // Prepare source and destination URLs
    let srcUrl = sourceRepo;
    if (sourceToken && srcUrl.startsWith("https://")) {
      srcUrl = srcUrl.replace("https://", `https://${sourceToken}@`);
    }
    let dstUrl = destinationRepo;
    if (dstUrl.startsWith("https://")) {
      dstUrl = dstUrl.replace("https://", `https://${destinationToken}@`);
    }

    // Always perform a fresh clone of the destination repo
    core.info("Cloning destination repo...");
    const git = simpleGit();
    await git.clone(dstUrl, "repo");

    const repo = simpleGit("repo");

    // Add source as remote (if not already)
    const remotes = await repo.getRemotes(true);
    const sourceRemoteExists = remotes.some((r) => r.name === "source");

    if (!sourceRemoteExists) {
      await repo.addRemote("source", srcUrl);
    } else {
      await repo.removeRemote("source");
      await repo.addRemote("source", srcUrl);
    }
    await repo.fetch("source");

    if (syncAllBranches) {
      // Get all remote branches from source
      const branches = await repo.branch(["-r"]);
      const branchNames = branches.all
        .filter((b) => b.startsWith("source/") && !b.includes("->"))
        .map((b) => b.replace("source/", ""));

      for (const branch of branchNames) {
        core.info(`Syncing branch: ${branch}`);
        await repo.push(
          "origin",
          `refs/remotes/source/${branch}:refs/heads/${branch}`,
          { "--force": null },
        );
      }
    } else {
      // Fetch and sync only the specified branch
      await repo.fetch("source", sourceBranch);
      await repo.push(
        "origin",
        `refs/remotes/source/${sourceBranch}:refs/heads/${destinationBranch}`,
        { "--force": null },
      );
    }

    // Sync tags if requested
    if (syncTags === "true") {
      await repo.fetch("source", "--tags");
      await repo.pushTags("origin", { "--force": null });
    } else if (syncTags) {
      await repo.fetch("source", "--tags");
      // Filter and push tags matching pattern
      const allTags = await repo.tags();
      const matchingTags = allTags.all.filter((tag) => tag.match(syncTags));
      for (const tag of matchingTags) {
        if (tag) {
          await repo.push("origin", `refs/tags/${tag}:refs/tags/${tag}`, {
            "--force": null,
          });
        }
      }
    }

    core.info("Sync complete!");
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
