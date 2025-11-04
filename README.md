# GitHub Sync

A GitHub Action for syncing the current repository using **force push**.

## Features

- Sync branches between two GitHub repositories
- Sync branches from a remote repository
- GitHub Action can be triggered on a timer or on push events
- Support syncing tags

## Usage

Create a Personal Access Token and add to repository's secret as `PAT`

### GitHub Actions

```
# File: .github/workflows/repo-sync.yml

on:
  schedule:
  - cron:  "*/15 * * * *"
  workflow_dispatch:

jobs:
  repo-sync:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v5
      with:
        persist-credentials: false
    - name: repo-sync
      uses: renan-alm/github-sync@v1
      with:
        source_repo: ""
        source_branch: ""
        destination_branch: ""
        sync_tags: ""
        github_token: ${{ secrets.PAT }}
```

If `source_repo` is private or with another provider, either (1) use an authenticated HTTPS repo clone url like `https://${access_token}@github.com/owner/repository.git` or (2) set a `SSH_PRIVATE_KEY` secret environment variable and use the SSH clone url

### Workflow overwriting

If `destination_branch` and the branch where you will create this workflow will be the same, The workflow (and all files) will be overwritten by `source_branch` files. A potential solution is: Create a new branch with the actions file and make it the default branch. You can update `sync_tags` to match tags you want to sync, e.g `android-14.0.0_*`.

## Advanced Usage: Sync all branches

1. Make a backup
2. Create a new branch in your repo (destination repo), it should not share the name with any branch in source repo
3. Make the new branch the default branch under repo settings
4. Use `*` for both `source_branch` and `destination_branch`
5. Optionally, you can force sync all tags:
   ```
   with:
     sync_tags: "true" # or * to match all tags.
   ```
   This will force sync ALL branches to match source repo. Branches that are created only in the destination repo will not be affected but all the other branches will be _hard reset_ to match source repo. ⚠️ This does mean if upstream ever creates a branch that shares the name, your changes will be gone.
