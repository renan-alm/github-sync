# GitHub Sync

A GitHub Action for syncing repositories across different SCM providers using **force push**. Supports GitHub, GitLab, Gitea, and other Git-based platforms.

## Features

- Sync branches between two repositories on any Git-based SCM platform
- Sync specific branches or all branches from a source repository
- Support for both PAT (Personal Access Token) and GitHub App authentication
- Support syncing tags (all or by regex pattern)
- Works with HTTPS and SSH URLs
- Can be triggered on a timer or on push events

## Usage

### Prerequisites

You can authenticate using either:

**Option 1: GitHub Personal Access Token (PAT)**

- Create a Personal Access Token with repo access
- Add it as a repository secret (e.g., `PAT`)

**Option 2: GitHub App** (Recommended for security)

- Create a GitHub App or use an existing one
- Get your GitHub App ID, private key, and installation ID
- Add these as repository secrets

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
        uses: repo-sync/github-sync@v2
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
- `source_token` (optional): Access token for private source repos (required for private HTTPS repos without embedded credentials)
- `sync_all_branches` (optional): `true` to sync all branches from source repo

**Authentication (provide one of the following):**

- `github_token` (optional): GitHub Personal Access Token (PAT) for authentication
- `github_app_id` (optional): GitHub App ID
- `github_app_private_key` (optional): GitHub App private key
- `github_app_installation_id` (optional): GitHub App installation ID

> **Note**: Either `github_token` OR all three GitHub App parameters must be provided for HTTPS authentication. SSH URLs do not require tokens if SSH keys are configured.

### Workflow Considerations

If `destination_branch` is the same as the branch containing this workflow file, the workflow (and all files) will be overwritten by `source_branch` files. A potential solution is:

1. Create a new branch in your destination repo that won't conflict with source branches
2. Make it the default branch in repository settings
3. Place the workflow file on this branch

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
