#!/usr/bin/env node

import { validateGitHubToken, setupSSHKey, sync } from "./lib/sync.js";

/**
 * Get inputs from GitHub Actions or CLI arguments
 */
function getInputs() {
  const args = process.argv.slice(2);

  // Check if running in GitHub Actions context
  const isGitHubActions = process.env.GITHUB_ACTION !== undefined;

  if (isGitHubActions) {
    // Running as GitHub Action - read from inputs via environment variables
    return {
      upstreamRepo: process.env.INPUT_SOURCE_REPO,
      branchMapping: `${process.env.INPUT_SOURCE_BRANCH}:${process.env.INPUT_DESTINATION_BRANCH}`,
      githubToken: process.env.INPUT_GITHUB_TOKEN,
      syncTags: process.env.INPUT_SYNC_TAGS,
      sshPrivateKey: process.env.INPUT_SSH_PRIVATE_KEY,
    };
  }

  // Running as CLI - read from command-line arguments
  return {
    upstreamRepo: args[0],
    branchMapping: args[1],
    githubToken: process.env.GITHUB_TOKEN,
    syncTags: process.env.SYNC_TAGS,
    sshPrivateKey: process.env.SSH_PRIVATE_KEY,
  };
}

/**
 * Main entry point for the GitHub Sync action
 */
async function main() {
  try {
    const inputs = getInputs();
    const { upstreamRepo, branchMapping } = inputs;

    if (!upstreamRepo || !branchMapping) {
      console.error(
        "Usage: github-sync <upstream_repo> <source_branch:destination_branch>"
      );
      console.error("");
      console.error("Environment Variables:");
      console.error(
        "  GITHUB_TOKEN       (required) GitHub token for authentication"
      );
      console.error(
        "  GITHUB_ACTOR       (required) GitHub actor (usually ${{ github.actor }})"
      );
      console.error(
        "  GITHUB_REPOSITORY  (required) GitHub repository (usually ${{ github.repository }})"
      );
      console.error(
        "  SSH_PRIVATE_KEY    (optional) SSH private key for authentication"
      );
      console.error(
        "  SYNC_TAGS          (optional) Sync tags (true, false, or pattern)"
      );
      process.exit(1);
    }

    // Validate prerequisites
    validateGitHubToken();
    setupSSHKey();

    // Execute the sync
    await sync(upstreamRepo, branchMapping);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main();
