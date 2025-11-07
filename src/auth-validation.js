import * as core from "@actions/core";

/**
 * Authentication Validation Module
 * Provides comprehensive error checking and user guidance for authentication mismatches
 */

// ===== PROTOCOL DETECTION =====

/**
 * Check if URL is SSH-based
 * @param {string} url - Repository URL
 * @returns {boolean} True if URL uses SSH protocol
 */
function isSSHUrl(url) {
  return url.startsWith("git@") || url.startsWith("ssh://");
}

/**
 * Check if URL is HTTPS-based
 * @param {string} url - Repository URL
 * @returns {boolean} True if URL uses HTTPS protocol
 */
function isHTTPSUrl(url) {
  return url.startsWith("https://");
}

/**
 * Get URL protocol type for display
 * @param {string} url - Repository URL
 * @returns {string} Protocol type
 */
function getProtocolType(url) {
  if (isSSHUrl(url)) return "SSH";
  if (isHTTPSUrl(url)) return "HTTPS";
  return "Unknown";
}

// ===== VALIDATION HELPERS =====

/**
 * Validate repo URL against available authentication
 * @param {string} repoName - "source" or "destination" for error messages
 * @param {string} repoUrl - Repository URL
 * @param {boolean} hasSSHAuth - SSH authentication available
 * @param {boolean} hasTokenAuth - Token authentication available
 * @returns {Array} Array of error objects (empty if valid)
 */
function validateRepoAuth(repoName, repoUrl, hasSSHAuth, hasTokenAuth) {
  const errors = [];
  const isSSH = isSSHUrl(repoUrl);
  const isHTTPS = isHTTPSUrl(repoUrl);

  // SSH repo requires SSH auth
  if (isSSH && !hasSSHAuth) {
    errors.push({
      field: `${repoName}_repo`,
      issue: `${repoName === "source" ? "Source" : "Destination"} repo uses SSH but no SSH key provided`,
      current: `${repoName === "source" ? "Source" : "Destination"}: ${repoUrl}`,
      missing: "ssh_key or ssh_key_path",
      suggestion: "Provide ssh_key (from secret) or ssh_key_path (from runner)",
    });
  }

  // SSH repo with wrong auth type (token instead of SSH)
  if (isSSH && hasTokenAuth && !hasSSHAuth) {
    errors.push({
      field: `${repoName}_repo + github_token`,
      issue: `${repoName === "source" ? "Source" : "Destination"} repo uses SSH but token is provided instead of SSH key`,
      current: `${repoName === "source" ? "Source" : "Destination"}: ${repoUrl} (SSH) + github_token provided`,
      wrong: "Token auth cannot be used with SSH URLs",
      suggestion: `Either (1) provide ssh_key for SSH, OR (2) convert ${repoName}_repo to HTTPS: https://github.com/org/repo.git`,
    });
  }

  // HTTPS repo requires token auth
  if (isHTTPS && !hasTokenAuth) {
    errors.push({
      field: `${repoName}_repo`,
      issue: `${repoName === "source" ? "Source" : "Destination"} repo uses HTTPS but no token provided`,
      current: `${repoName === "source" ? "Source" : "Destination"}: ${repoUrl}`,
      missing: "github_token or github_app_*",
      suggestion: "Provide github_token (PAT) or GitHub App credentials (app_id, private_key, installation_id)",
    });
  }

  // HTTPS repo with wrong auth type (SSH instead of token)
  if (isHTTPS && hasSSHAuth && !hasTokenAuth) {
    errors.push({
      field: `${repoName}_repo + ssh_key`,
      issue: `${repoName === "source" ? "Source" : "Destination"} repo uses HTTPS but SSH key is provided instead of token`,
      current: `${repoName === "source" ? "Source" : "Destination"}: ${repoUrl} (HTTPS) + ssh_key provided`,
      wrong: "SSH auth cannot be used with HTTPS URLs",
      suggestion: `Either (1) provide github_token for HTTPS, OR (2) convert ${repoName}_repo to SSH: git@github.com:org/repo.git`,
    });
  }

  return errors;
}

/**
 * Validate authentication configuration
 * Checks for mismatches between URL protocols and provided credentials
 * @param {Object} inputs - Action inputs
 * @param {string} inputs.sourceRepo - Source repository URL
 * @param {string} inputs.destinationRepo - Destination repository URL
 * @param {string} inputs.githubToken - GitHub token (if provided)
 * @param {string} inputs.githubAppId - GitHub App ID (if provided)
 * @param {string} inputs.githubAppPrivateKey - GitHub App private key (if provided)
 * @param {string} inputs.githubAppInstallationId - GitHub App installation ID (if provided)
 * @param {string} inputs.sshKey - SSH key content (if provided)
 * @param {string} inputs.sshKeyPath - SSH key file path (if provided)
 * @returns {Object} Validation result with any errors or warnings
 */
export function validateAuthentication(inputs) {
  const errors = [];
  const warnings = [];

  // Determine what authentication is provided
  const hasTokenAuth =
    !!inputs.githubToken ||
    (inputs.githubAppId &&
      inputs.githubAppPrivateKey &&
      inputs.githubAppInstallationId);
  const hasSSHAuth = !!inputs.sshKey || !!inputs.sshKeyPath;

  // Check repos
  const sourceProtocol = getProtocolType(inputs.sourceRepo);
  const destProtocol = getProtocolType(inputs.destinationRepo);

  // Log detected configuration
  core.debug(`Source repo protocol: ${sourceProtocol} (${inputs.sourceRepo})`);
  core.debug(`Destination repo protocol: ${destProtocol} (${inputs.destinationRepo})`);
  core.debug(`Token auth available: ${hasTokenAuth}`);
  core.debug(`SSH auth available: ${hasSSHAuth}`);

  // Validate source repo
  errors.push(
    ...validateRepoAuth("source", inputs.sourceRepo, hasSSHAuth, hasTokenAuth)
  );

  // Validate destination repo
  errors.push(
    ...validateRepoAuth("destination", inputs.destinationRepo, hasSSHAuth, hasTokenAuth)
  );

  // Check for unused credentials (warnings only)
  if (hasTokenAuth && isSSHUrl(inputs.sourceRepo) && isSSHUrl(inputs.destinationRepo)) {
    warnings.push({
      field: "github_token/github_app_*",
      issue: "Token provided but both repos use SSH",
      current: "Both repos are SSH-based",
      unused: "github_token or github_app_*",
      suggestion:
        "Remove github_token and github_app_* inputs as SSH key is sufficient",
    });
  }

  if (hasSSHAuth && isHTTPSUrl(inputs.sourceRepo) && isHTTPSUrl(inputs.destinationRepo)) {
    warnings.push({
      field: "ssh_key/ssh_key_path",
      issue: "SSH key provided but both repos use HTTPS",
      current: "Both repos are HTTPS-based",
      unused: "ssh_key or ssh_key_path",
      suggestion: "Remove SSH key inputs as github_token is sufficient",
    });
  }

  // Check for incomplete GitHub App credentials
  if (inputs.githubAppId && !inputs.githubAppPrivateKey) {
    errors.push({
      field: "github_app_private_key",
      issue: "GitHub App ID provided but private key is missing",
      current: "app_id provided, private_key missing",
      missing: "github_app_private_key",
      suggestion:
        "Provide all three: github_app_id, github_app_private_key, github_app_installation_id",
    });
  }

  if (inputs.githubAppId && !inputs.githubAppInstallationId) {
    errors.push({
      field: "github_app_installation_id",
      issue: "GitHub App ID provided but installation ID is missing",
      current: "app_id provided, installation_id missing",
      missing: "github_app_installation_id",
      suggestion:
        "Provide all three: github_app_id, github_app_private_key, github_app_installation_id",
    });
  }

  if (inputs.githubAppPrivateKey && !inputs.githubAppId) {
    errors.push({
      field: "github_app_id",
      issue: "GitHub App private key provided but app ID is missing",
      current: "private_key provided, app_id missing",
      missing: "github_app_id",
      suggestion:
        "Provide all three: github_app_id, github_app_private_key, github_app_installation_id",
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    summary: {
      sourceProtocol,
      destProtocol,
      hasTokenAuth,
      hasSSHAuth,
    },
  };
}

// ===== FORMATTERS =====

const ErrorFormatter = {
  header() {
    return (
      "╔════════════════════════════════════════════════════════════╗\n" +
      "║         AUTHENTICATION CONFIGURATION MISMATCH              ║\n" +
      "╚════════════════════════════════════════════════════════════╝\n\n"
    );
  },

  configuration(summary) {
    return (
      "📋 DETECTED CONFIGURATION:\n" +
      `  • Source repo:      ${summary.sourceProtocol}\n` +
      `  • Destination repo: ${summary.destProtocol}\n` +
      `  • Token auth:       ${summary.hasTokenAuth ? "✓ Yes" : "✗ No"}\n` +
      `  • SSH auth:         ${summary.hasSSHAuth ? "✓ Yes" : "✗ No"}\n\n`
    );
  },

  issueItem(item, index) {
    return (
      `\n  ${index + 1}. ${item.issue}\n` +
      `     Field: ${item.field}\n` +
      `     Current: ${item.current}\n` +
      `     ${item.missing ? `Missing: ${item.missing}` : `Unused: ${item.unused}`}\n` +
      `     ✓ Fix: ${item.suggestion}\n`
    );
  },

  errors(errorList) {
    if (errorList.length === 0) return "";
    return (
      "❌ ERRORS (Fix required):\n" +
      errorList.map((e, i) => this.issueItem(e, i)).join("") +
      "\n"
    );
  },

  warnings(warningList) {
    if (warningList.length === 0) return "";
    return (
      "⚠️  WARNINGS (Optional cleanup):\n" +
      warningList.map((w, i) => this.issueItem(w, i)).join("") +
      "\n"
    );
  },

  quickReference() {
    return (
      "📖 QUICK REFERENCE:\n" +
      "  HTTPS URLs require:     github_token OR github_app_*\n" +
      "  SSH URLs require:       ssh_key OR ssh_key_path\n" +
      "  Mixed URLs require:     BOTH token AND ssh_key\n\n"
    );
  },

  examples(summary) {
    let text = "💡 EXAMPLES:\n";

    if (summary.sourceProtocol === "HTTPS" || summary.destProtocol === "HTTPS") {
      text +=
        "  HTTPS example:\n" +
        "    with:\n" +
        "      source_repo: https://github.com/org/repo.git\n" +
        "      github_token: ${{ secrets.GITHUB_TOKEN }}\n\n";
    }

    if (summary.sourceProtocol === "SSH" || summary.destProtocol === "SSH") {
      text +=
        "  SSH example:\n" +
        "    with:\n" +
        "      source_repo: git@github.com:org/repo.git\n" +
        "      ssh_key: ${{ secrets.SSH_KEY }}\n\n";
    }

    text +=
      "  Mixed example:\n" +
      "    with:\n" +
      "      source_repo: https://github.com/public/repo.git\n" +
      "      destination_repo: git@internal-git.com:repo.git\n" +
      "      github_token: ${{ secrets.GITHUB_TOKEN }}\n" +
      "      ssh_key: ${{ secrets.SSH_KEY }}\n\n";

    return text;
  },

  documentation() {
    return "📚 See SSH_AUTHENTICATION.md and README.md for detailed guides\n";
  },
};

/**
 * Format validation errors as user-friendly messages
 * @param {Object} validation - Validation result from validateAuthentication
 * @returns {string} Formatted error message
 */
export function formatValidationErrors(validation) {
  if (validation.isValid && validation.warnings.length === 0) {
    return null;
  }

  return (
    ErrorFormatter.header() +
    ErrorFormatter.configuration(validation.summary) +
    ErrorFormatter.errors(validation.errors) +
    ErrorFormatter.warnings(validation.warnings) +
    ErrorFormatter.quickReference() +
    ErrorFormatter.examples(validation.summary) +
    ErrorFormatter.documentation()
  );
}

/**
 * Log validation result to core
 * @param {Object} validation - Validation result
 */
export function logValidationResult(validation) {
  if (!validation.isValid) {
    const formatted = formatValidationErrors(validation);
    core.error(formatted);
  } else if (validation.warnings.length > 0) {
    core.warning("Authentication validation has warnings:\n" + formatValidationErrors(validation));
  } else {
    core.info("✓ Authentication configuration is valid");
  }
}
