import * as core from "@actions/core";

/**
 * Authentication Validation Module
 * Provides comprehensive error checking and user guidance for authentication mismatches
 */

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

  // Check source repo
  const sourceIsSSH = isSSHUrl(inputs.sourceRepo);
  const sourceIsHTTPS = isHTTPSUrl(inputs.sourceRepo);
  const sourceProtocol = getProtocolType(inputs.sourceRepo);

  // Check destination repo
  const destIsSSH = isSSHUrl(inputs.destinationRepo);
  const destIsHTTPS = isHTTPSUrl(inputs.destinationRepo);
  const destProtocol = getProtocolType(inputs.destinationRepo);

  // Log detected configuration
  core.debug(`Source repo protocol: ${sourceProtocol} (${inputs.sourceRepo})`);
  core.debug(`Destination repo protocol: ${destProtocol} (${inputs.destinationRepo})`);
  core.debug(`Token auth available: ${hasTokenAuth}`);
  core.debug(`SSH auth available: ${hasSSHAuth}`);

  // ===== VALIDATION LOGIC =====

  // 1. Source repo validation
  if (sourceIsHTTPS && !hasTokenAuth) {
    errors.push({
      field: "source_repo",
      issue: `Source repo uses HTTPS but no token provided`,
      current: `Source: ${inputs.sourceRepo}`,
      missing: "github_token or github_app_*",
      suggestion:
        "Provide github_token (PAT) or GitHub App credentials (app_id, private_key, installation_id)",
    });
  }

  if (sourceIsSSH && !hasSSHAuth) {
    errors.push({
      field: "source_repo",
      issue: `Source repo uses SSH but no SSH key provided`,
      current: `Source: ${inputs.sourceRepo}`,
      missing: "ssh_key or ssh_key_path",
      suggestion: "Provide ssh_key (from secret) or ssh_key_path (from runner)",
    });
  }

  // 2. Destination repo validation
  if (destIsHTTPS && !hasTokenAuth) {
    errors.push({
      field: "destination_repo",
      issue: `Destination repo uses HTTPS but no token provided`,
      current: `Destination: ${inputs.destinationRepo}`,
      missing: "github_token or github_app_*",
      suggestion:
        "Provide github_token (PAT) or GitHub App credentials (app_id, private_key, installation_id)",
    });
  }

  if (destIsSSH && !hasSSHAuth) {
    errors.push({
      field: "destination_repo",
      issue: `Destination repo uses SSH but no SSH key provided`,
      current: `Destination: ${inputs.destinationRepo}`,
      missing: "ssh_key or ssh_key_path",
      suggestion: "Provide ssh_key (from secret) or ssh_key_path (from runner)",
    });
  }

  // 3. Check for unused credentials
  if (hasTokenAuth && sourceIsSSH && destIsSSH) {
    warnings.push({
      field: "github_token/github_app_*",
      issue: "Token provided but both repos use SSH",
      current: "Both repos are SSH-based",
      unused: "github_token or github_app_*",
      suggestion:
        "Remove github_token and github_app_* inputs as SSH key is sufficient",
    });
  }

  if (hasSSHAuth && sourceIsHTTPS && destIsHTTPS) {
    warnings.push({
      field: "ssh_key/ssh_key_path",
      issue: "SSH key provided but both repos use HTTPS",
      current: "Both repos are HTTPS-based",
      unused: "ssh_key or ssh_key_path",
      suggestion: "Remove SSH key inputs as github_token is sufficient",
    });
  }

  // 4. Check for incomplete GitHub App credentials
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

/**
 * Format validation errors as user-friendly messages
 * @param {Object} validation - Validation result from validateAuthentication
 * @returns {string} Formatted error message
 */
export function formatValidationErrors(validation) {
  if (validation.isValid && validation.warnings.length === 0) {
    return null;
  }

  let message = "";

  // Add summary
  message += "╔════════════════════════════════════════════════════════════╗\n";
  message += "║         AUTHENTICATION CONFIGURATION MISMATCH              ║\n";
  message += "╚════════════════════════════════════════════════════════════╝\n\n";

  // Add detected configuration
  message += "📋 DETECTED CONFIGURATION:\n";
  message += `  • Source repo:      ${validation.summary.sourceProtocol}\n`;
  message += `  • Destination repo: ${validation.summary.destProtocol}\n`;
  message += `  • Token auth:       ${validation.summary.hasTokenAuth ? "✓ Yes" : "✗ No"}\n`;
  message += `  • SSH auth:         ${validation.summary.hasSSHAuth ? "✓ Yes" : "✗ No"}\n\n`;

  // Add errors
  if (validation.errors.length > 0) {
    message += "❌ ERRORS (Fix required):\n";
    validation.errors.forEach((error, index) => {
      message += `\n  ${index + 1}. ${error.issue}\n`;
      message += `     Field: ${error.field}\n`;
      message += `     Current: ${error.current}\n`;
      message += `     Missing: ${error.missing}\n`;
      message += `     ✓ Fix: ${error.suggestion}\n`;
    });
    message += "\n";
  }

  // Add warnings
  if (validation.warnings.length > 0) {
    message += "⚠️  WARNINGS (Optional cleanup):\n";
    validation.warnings.forEach((warning, index) => {
      message += `\n  ${index + 1}. ${warning.issue}\n`;
      message += `     Field: ${warning.field}\n`;
      message += `     Current: ${warning.current}\n`;
      message += `     Unused: ${warning.unused}\n`;
      message += `     ✓ Fix: ${warning.suggestion}\n`;
    });
    message += "\n";
  }

  // Add quick reference
  message += "📖 QUICK REFERENCE:\n";
  message += "  HTTPS URLs require:     github_token OR github_app_*\n";
  message += "  SSH URLs require:       ssh_key OR ssh_key_path\n";
  message += "  Mixed URLs require:     BOTH token AND ssh_key\n\n";

  // Add examples
  message += "💡 EXAMPLES:\n";
  if (validation.summary.sourceProtocol === "HTTPS" ||
      validation.summary.destProtocol === "HTTPS") {
    message += "  HTTPS example:\n";
    message += "    with:\n";
    message += "      source_repo: https://github.com/org/repo.git\n";
    message += "      github_token: ${{ secrets.GITHUB_TOKEN }}\n\n";
  }
  if (validation.summary.sourceProtocol === "SSH" ||
      validation.summary.destProtocol === "SSH") {
    message += "  SSH example:\n";
    message += "    with:\n";
    message += "      source_repo: git@github.com:org/repo.git\n";
    message += "      ssh_key: ${{ secrets.SSH_KEY }}\n\n";
  }
  message += "  Mixed example:\n";
  message += "    with:\n";
  message += "      source_repo: https://github.com/public/repo.git\n";
  message += "      destination_repo: git@internal-git.com:repo.git\n";
  message += "      github_token: ${{ secrets.GITHUB_TOKEN }}\n";
  message += "      ssh_key: ${{ secrets.SSH_KEY }}\n\n";

  // Add link to documentation
  message += "📚 See SSH_AUTHENTICATION.md and README.md for detailed guides\n";

  return message;
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
