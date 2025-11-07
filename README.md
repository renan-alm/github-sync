# GitHub Repo Sync

A GitHub Action for syncing repositories across different SCM providers using **force push**. Supports GitHub, GitLab, Gitea, and other Git-based platforms.

## Features

- ✅ Sync branches between any two Git-based repositories
- ✅ Sync specific branches or all branches from a source repository
- ✅ Automatic branch fallback (main → master) for missing branches
- ✅ Support syncing tags (all tags, regex patterns, or disabled)
- ✅ Dual authentication options:
  - Personal Access Token (PAT)
  - GitHub App installation token
- ✅ Multi-SCM platform support (GitHub, GitLab, Gitea, etc.)
- ✅ Works with HTTPS and SSH URLs
- ✅ Force push for complete synchronization
- ✅ Comprehensive logging and progress tracking
- ✅ Can be triggered on a timer or on push events

## How It Works

The action performs the following steps:

1. **Authentication**: Validates and obtains token via PAT or GitHub App
2. **Git Configuration**: Sets up git user identity globally
3. **URL Preparation**: Embeds authentication credentials in repository URLs for HTTPS repos
4. **Destination Clone**: Clones the destination repository
5. **Source Remote**: Adds source repository as remote and fetches all branches/tags
6. **Branch Sync**: Syncs branches with force push (specific branch or all branches)
7. **Tag Sync**: Syncs tags if enabled (all tags, pattern matching, or disabled)

### Prerequisites

You can authenticate using either:

#### Option 1: GitHub Personal Access Token (PAT)

- Create a Personal Access Token with repo access
- Add it as a repository secret (e.g., `PAT`)

#### Option 2: GitHub App (Recommended for security)

- Create a GitHub App or use an existing one
- Get your GitHub App ID, private key, and installation ID
- Add these as repository secrets

#### Option 3: SSH (For private/self-hosted repositories)

- Generate an SSH key pair
- Add the public key to your Git host
- Add the private key as a repository secret
- Use SSH URLs in your workflow

### SSH Authentication - Key Features

#### 1. Multiple SSH Key Input Methods

```yaml
# Method 1: Direct SSH key from secret
ssh_key: ${{ secrets.SSH_KEY }}

# Method 2: SSH key file path
ssh_key_path: /home/runner/.ssh/id_rsa

# Method 3: Encrypted SSH key with passphrase
ssh_key: ${{ secrets.SSH_KEY }}
ssh_passphrase: ${{ secrets.SSH_PASSPHRASE }}
```

#### 2. Flexible Key Format Support

- **Raw OpenSSH private key** (with BEGIN/END markers)
- **Escaped newlines** (\\n) from GitHub Secrets
- **Base64 encoded** (automatically decoded)

#### 3. Automatic SSH Configuration

- Pre-configured for GitHub, GitLab, Gitea, Gerrit
- Prevents host verification prompts
- Fallback config for custom hosts

#### 4. URL-Based Authentication Detection

```javascript
// Automatically detects and routes:
git@github.com:owner/repo.git      → SSH Agent
https://github.com/owner/repo.git  → Token Auth
ssh://gerrit.com/repo              → SSH Agent
```

#### 5. Mixed Authentication Support

```yaml
# Can use both SSH and HTTPS in same sync
source_repo: "https://github.com/public/repo.git"      # HTTPS
destination_repo: "git@internal-git.com:repo.git"      # SSH
github_token: ${{ secrets.GITHUB_TOKEN }}              # For HTTPS
ssh_key: ${{ secrets.SSH_KEY }}                        # For SSH
```

### GitHub Actions - Using PAT

```yaml
# File: .github/workflows/repo-sync.yml

on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:

jobs:
  repo-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: repo-sync
        uses: renan-alm/github-repo-sync@v2
        with:
          source_repo: "https://github.com/owner/source-repo.git"
          source_branch: "main"
          destination_repo: "https://github.com/owner/destination-repo.git"
          destination_branch: "main"
          sync_tags: "true"
          github_token: ${{ secrets.PAT }}
```

### GitHub Actions - Using GitHub App

```yaml
# File: .github/workflows/repo-sync.yml

on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:

jobs:
  repo-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: repo-sync
        uses: repo-sync/github-sync@v2
        with:
          source_repo: "https://github.com/owner/source-repo.git"
          source_branch: "main"
          destination_repo: "https://github.com/owner/destination-repo.git"
          destination_branch: "main"
          sync_tags: "true"
          github_app_id: ${{ secrets.GITHUB_APP_ID }}
          github_app_private_key: ${{ secrets.GITHUB_APP_PRIVATE_KEY }}
          github_app_installation_id: ${{ secrets.GITHUB_APP_INSTALLATION_ID }}
```

### Input Parameters

- `source_repo` (required): Full repository URL (supports GitHub, GitLab, Gitea, etc.). Examples:
  - GitHub: `https://github.com/owner/repo.git`
  - GitLab: `https://gitlab.com/owner/repo.git`
  - Gitea: `https://gitea.example.com/owner/repo.git`
  - SSH: `git@github.com:owner/repo.git`
- `source_branch` (required): Branch name to sync from
- `destination_repo` (required): Full repository URL for the destination repository
- `destination_branch` (required): Branch name to sync to
- `sync_tags` (optional): `true` to sync all tags, regex pattern to sync matching tags, or omit to skip
- `source_token` (optional): Access token for private source repos (required for private HTTPS repos without embedded credentials). When provided with `destination_token`, enables different tokens for source and destination repos.
- `destination_token` (optional): Access token specifically for destination repo. When provided, `source_token` is required. Enables using different credentials for source and destination repositories.
- `sync_all_branches` (optional): `true` to sync all branches from source repo
- `use_main_as_fallback` (optional): `true` (default) to fallback to `main` or `master` if specified branch not found, `false` for strict branch matching

**Authentication (provide one of the following):**

- `github_token` (optional): GitHub Personal Access Token (PAT) used for both source and destination HTTPS repos if separate tokens not provided
- `github_app_id`, `github_app_private_key`, `github_app_installation_id` (optional): GitHub App for HTTPS authentication

**For Separate Tokens Per Repository:**

- `source_token`: PAT for source repo
- `destination_token`: PAT for destination repo
- Both required when using separate tokens for different repositories

> **Note**: For HTTPS URLs, provide either a `github_token` OR all three GitHub App parameters OR use `source_token`/`destination_token` pair for separate credentials. SSH URLs don't require authentication if SSH keys are configured.

### Workflow Considerations

#### Branch Fallback Behavior

By default, if the specified `source_branch` doesn't exist in the source repository, the action will automatically try `main` or `master` as fallbacks (in that order). This makes the action more flexible when dealing with repositories that use different default branch names.

**Example**: If you specify `source_branch: main` but the source repo only has `master`, it will automatically sync `master` instead.

To disable this behavior and require exact branch matching, set `use_main_as_fallback: false`:

```yaml
with:
  source_branch: "main"
  use_main_as_fallback: false # Fail if exact branch not found
```

#### Workflow File Location

If `destination_branch` is the same as the branch containing this workflow file, the workflow (and all files) will be overwritten by `source_branch` files. A potential solution is:

1. Create a new branch in your destination repo that won't conflict with source branches
2. Make it the default branch in repository settings
3. Place the workflow file on this branch

#### What "Sync" Means

This action performs a **complete mirror** of the specified branch(es) from source to destination using `git push --force`. This means:

- **All commits** are copied exactly as they are in the source
- **History is preserved** - nothing is rebased or squashed
- **Files are overwritten** - if a file differs between repos, destination gets source's version
- **Previous changes on destination** are lost if they conflict with source
- **This is not a merge** - it's a complete replacement of the destination branch with source branch

This is useful for:

- Mirroring public repositories
- Syncing configuration repositories
- Keeping backup copies in sync
- Cross-platform repository synchronization

⚠️ **Note**: Use with caution on branches with important local-only content.

### Advanced Usage: Sync all branches

To sync all branches from source to destination:

1. Make a backup of your destination repo
2. Create a new branch in your destination repo (e.g., `sync-workflow`) that doesn't share names with any source branches
3. Make this new branch the default branch in repo settings
4. Set `sync_all_branches: "true"` in your workflow

```yaml
with:
  sync_all_branches: "true"
  sync_tags: "true" # Optional: sync all tags
```

This will force sync ALL branches to match the source repo. Branches created only in the destination repo will not be affected, but all other branches will be hard reset to match the source repo.

⚠️ **Warning**: If the upstream source creates a branch that shares the name with your destination branch, your changes on that branch will be overwritten.

## Examples

### Example 1: Sync specific branch with PAT (default fallback enabled)

```yaml
- uses: renan-alm/github-repo-sync@simple
  with:
    source_repo: "https://github.com/org/upstream-repo.git"
    source_branch: "main"
    destination_repo: "https://github.com/org/mirror-repo.git"
    destination_branch: "main"
    sync_tags: "true"
    github_token: ${{ secrets.PAT }}
```

If `main` doesn't exist in source, automatically falls back to `master`.

### Example 2: Sync all branches with GitHub App

```yaml
- uses: renan-alm/github-repo-sync@simple
  with:
    source_repo: "https://github.com/org/upstream-repo.git"
    destination_repo: "https://github.com/org/mirror-repo.git"
    sync_all_branches: "true"
    sync_tags: "true"
    github_app_id: ${{ secrets.GITHUB_APP_ID }}
    github_app_private_key: ${{ secrets.GITHUB_APP_PRIVATE_KEY }}
    github_app_installation_id: ${{ secrets.GITHUB_APP_INSTALLATION_ID }}
```

### Example 3: Sync tags matching a regex pattern

```yaml
- uses: renan-alm/github-repo-sync@simple
  with:
    source_repo: "https://github.com/org/upstream-repo.git"
    source_branch: "main"
    destination_repo: "https://github.com/org/mirror-repo.git"
    destination_branch: "main"
    sync_tags: "^v[0-9]+\\.[0-9]+\\.[0-9]+$" # Only version tags like v1.0.0
    github_token: ${{ secrets.PAT }}
```

### Example 4: Strict branch matching without fallback

```yaml
- uses: renan-alm/github-repo-sync@simple
  with:
    source_repo: "https://github.com/org/upstream-repo.git"
    source_branch: "develop"
    destination_repo: "https://github.com/org/mirror-repo.git"
    destination_branch: "develop"
    use_main_as_fallback: "false" # Fail if 'develop' doesn't exist
    github_token: ${{ secrets.PAT }}
```

### Example 5: Cross-platform sync (GitHub to GitLab)

```yaml
- uses: renan-alm/github-repo-sync@simple
  with:
    source_repo: "https://github.com/org/github-repo.git"
    source_branch: "main"
    source_token: ${{ secrets.GITHUB_TOKEN }}
    destination_repo: "https://gitlab.com/org/gitlab-repo.git"
    destination_branch: "main"
    github_token: ${{ secrets.GITLAB_TOKEN }}
```

### Example 6: SSH with Single Host

```yaml
name: Sync with SSH

on:
  schedule:
    - cron: "0 * * * *"

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: renan-alm/github-repo-sync@v2
        with:
          source_repo: "git@github.com:upstream/repo.git"
          source_branch: "main"
          destination_repo: "git@github.com:mirror/repo.git"
          destination_branch: "main"
          sync_tags: "true"
          ssh_key: ${{ secrets.SSH_KEY }}
```

### Example 7: SSH with Multiple Hosts

```yaml
- uses: renan-alm/github-repo-sync@v2
  with:
    source_repo: "git@gitlab.com:org/source-repo.git"
    source_branch: "develop"
    destination_repo: "git@gerrit.company.com:destination-repo.git"
    destination_branch: "develop"
    ssh_key: ${{ secrets.SSH_KEY }}
```

### Example 8: Mixed HTTPS and SSH

```yaml
# Use HTTPS for source, SSH for destination
- uses: renan-alm/github-repo-sync@v2
  with:
    source_repo: "https://github.com/public/repo.git"
    source_branch: "main"
    destination_repo: "git@internal-git.company.com:repo.git"
    destination_branch: "main"
    github_token: ${{ secrets.GITHUB_TOKEN }}
    ssh_key: ${{ secrets.SSH_KEY }}
```

### Example 9: SSH with Encrypted Key

```yaml
### Example 9: SSH with Encrypted Key

```yaml
- uses: renan-alm/github-repo-sync@v2
  with:
    source_repo: "git@github.com:owner/source.git"
    source_branch: "main"
    destination_repo: "git@github.com:owner/destination.git"
    destination_branch: "main"
    ssh_key: ${{ secrets.SSH_KEY }}
    ssh_passphrase: ${{ secrets.SSH_PASSPHRASE }}
```

### Example 10: Different tokens for source and destination

Sync from one platform with one token to another platform with a different token:

```yaml
# Sync from GitHub to GitLab with separate credentials
- uses: renan-alm/github-repo-sync@v2
  with:
    source_repo: "https://github.com/org/github-repo.git"
    source_branch: "main"
    source_token: ${{ secrets.GITHUB_TOKEN }}
    
    destination_repo: "https://gitlab.com/org/gitlab-repo.git"
    destination_branch: "main"
    destination_token: ${{ secrets.GITLAB_TOKEN }}
    
    sync_tags: "true"
```

**When to use separate tokens:**

- Syncing between different Git platforms (GitHub ↔ GitLab, GitHub ↔ Gitea, etc.)
- Source and destination repos owned by different organizations
- Different permission levels needed for each repository
- Cross-tenant or cross-account synchronization

⚠️ **Note**: When using `source_token` and `destination_token`, provide both or provide neither. Mix `source_token`/`destination_token` with `github_token` is not supported.

````
```
