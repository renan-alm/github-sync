#!/usr/bin/env node

import { validateGitHubToken, setupSSHKey, sync } from "./lib/sync.js";

/**
 * Main entry point for the GitHub Sync action
 */
async function main() {
  try {
    // Validate prerequisites
    validateGitHubToken();
    setupSSHKey();

    // Parse command line arguments
    const args = process.argv.slice(2);
    const upstreamRepo = args[0];
    const branchMapping = args[1];

    if (!upstreamRepo || !branchMapping) {
      console.error(
        "Usage: github-sync <upstream_repo> <source_branch:destination_branch>",
      );
      console.error("");
      console.error("Environment Variables:");
      console.error(
        "  GITHUB_TOKEN       (required) GitHub token for authentication",
      );
      console.error(
        "  GITHUB_ACTOR       (required) GitHub actor (usually ${{ github.actor }})",
      );
      console.error(
        "  GITHUB_REPOSITORY  (required) GitHub repository (usually ${{ github.repository }})",
      );
      console.error(
        "  SSH_PRIVATE_KEY    (optional) SSH private key for authentication",
      );
      console.error(
        "  SYNC_TAGS          (optional) Sync tags (true, false, or pattern)",
      );
      process.exit(1);
    }

    // Execute the sync
    await sync(upstreamRepo, branchMapping);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main();
