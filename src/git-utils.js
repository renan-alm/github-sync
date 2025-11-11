
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { DEBUG_MESSAGES } from "./constants.js";

/**
 * Git Utilities Module
 * Shared Git operations used by both standard and Gerrit flows
 * Eliminates duplication between index.js and gerrit.js
 */

/**
 * Calculate merge base between destination and source branches
 * @param {string} destBranch - Destination branch (e.g., origin/main)
 * @param {string} sourceBranch - Source branch (e.g., source/main)
 * @returns {Promise<string|null>} Merge base commit hash or null if no common history
 */
export async function getMergeBase(destBranch, sourceBranch) {
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
export async function getRefCommit(ref) {
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
    core.debug(DEBUG_MESSAGES.REF_DOES_NOT_EXIST(ref, exitCode));
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
export async function hasDestinationBeenModified(destRef, sourceRef) {
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
    core.debug(DEBUG_MESSAGES.MERGE_BASE_NOT_FOUND);
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
export async function isSourceAheadOfDestination(destRef, sourceRef) {
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
