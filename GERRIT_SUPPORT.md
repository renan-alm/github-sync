# Gerrit Support

This action now includes **automatic detection and support for Gerrit repositories**.

## 🎯 What is Gerrit?

Gerrit is a code review tool built on Git, commonly used in enterprise environments. It uses special Git references (`refs/for/*`) for managing code reviews and change requests.

## 🔄 How It Works

When this action detects a Gerrit repository, it automatically:

1. **Detects Gerrit** - Uses URL-based pattern detection (Option 2)
2. **Switches to Gerrit flow** - Uses dedicated Gerrit-specific functions
3. **Pushes to review queue** - Uses `refs/for/*` instead of `refs/heads/*`
4. **Creates changes** - Commits are sent to Gerrit's review queue

## 🚀 Quick Start with Gerrit

### Example: Sync from GitHub to Gerrit

```yaml
name: Sync GitHub to Gerrit

on:
  schedule:
    - cron: "0 0 * * *"  # Daily
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false

      - name: Sync GitHub to Gerrit
        uses: renan-alm/github-repo-sync@v1
        with:
          source_repo: "https://github.com/myorg/my-repo.git"
          source_branch: "main"
          destination_repo: "https://gerrit.company.com/path/to/my-repo.git"
          destination_branch: "main"
          sync_tags: "true"
          github_token: ${{ secrets.GITHUB_TOKEN }}
          source_token: ${{ secrets.GERRIT_HTTP_PASSWORD }}
```

### Example: Sync from Gerrit to GitHub

```yaml
name: Sync Gerrit to GitHub

on:
  schedule:
    - cron: "0 0 * * *"  # Daily
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false

      - name: Sync Gerrit to GitHub
        uses: renan-alm/github-repo-sync@v1
        with:
          source_repo: "https://gerrit.company.com/path/to/my-repo.git"
          source_branch: "main"
          destination_repo: "https://github.com/myorg/my-repo.git"
          destination_branch: "main"
          sync_tags: "true"
          github_token: ${{ secrets.GITHUB_TOKEN }}
          source_token: ${{ secrets.GERRIT_HTTP_PASSWORD }}
```

## 🔍 Automatic Detection

The action automatically detects Gerrit repositories by checking for:

- `gerrit` in the URL domain or path
- Gerrit SSH default port `:29418`
- Gerrit review path pattern `/r/`

**No configuration needed!** The action handles it automatically.

## 🔐 Authentication

### Gerrit HTTP Authentication

Generate HTTP credentials from Gerrit:

1. Open Gerrit UI: `https://gerrit.company.com`
2. Go to **Settings** (⚙️) → **HTTP Credentials**
3. Generate or copy your HTTP password
4. Add to GitHub Secrets as `GERRIT_HTTP_PASSWORD`

Use in workflow:

```yaml
source_token: ${{ secrets.GERRIT_HTTP_PASSWORD }}
# OR
github_token: ${{ secrets.GERRIT_HTTP_PASSWORD }}
```

### Gerrit SSH Authentication

For SSH URLs (e.g., `ssh://gerrit.company.com:29418/repo.git`):

Add SSH key to GitHub Secrets and configure git to use it:

```yaml
- name: Setup SSH
  run: |
    mkdir -p ~/.ssh
    echo "${{ secrets.GERRIT_SSH_KEY }}" > ~/.ssh/id_rsa
    chmod 600 ~/.ssh/id_rsa
    ssh-keyscan -p 29418 gerrit.company.com >> ~/.ssh/known_hosts
```

## 📋 Gerrit-Specific Behavior

### Push Reference

Standard Git action uses:
```bash
git push origin HEAD:refs/heads/master
```

Gerrit-enabled action uses:
```bash
git push origin HEAD:refs/for/master
```

This sends commits to Gerrit's **review queue** instead of directly to the branch.

### What This Means

| Aspect | Standard Git | Gerrit |
|--------|-------------|--------|
| **Push Target** | `refs/heads/main` | `refs/for/main` |
| **Result** | Direct branch update | Change in review queue |
| **Approval** | Depends on repo | Requires review in Gerrit |
| **Commits** | Go directly to branch | Go to review queue first |

## ⚙️ Gerrit Permissions

For the sync to work, ensure your Gerrit user has:

- ✅ Read access to source repository (if Gerrit)
- ✅ Push permission to `refs/for/*` on destination branch
- ✅ OR direct push to `refs/heads/*` (if admin bypass configured)

### Ask Your Gerrit Administrator For

```
- Push permission to refs/for/* for user: [sync-user]
- Or: Direct push permission to refs/heads/* (for automated sync)
```

## 🔄 Workflow Comparison

### Standard (GitHub → GitHub)

```
Source Branch
    ↓
git push origin HEAD:refs/heads/main
    ↓
Destination Branch (Updated Immediately)
```

### Gerrit (Any → Gerrit)

```
Source Branch
    ↓
git push gerrit HEAD:refs/for/main
    ↓
Gerrit Review Queue (Change Created)
    ↓
(Manual or automatic approval)
    ↓
Destination Branch (Updated)
```

## ❓ FAQ

### Q: Will my sync get stuck in reviews?

**A:** No! The action creates changes in the review queue, but they won't be automatically approved. You have two options:

1. **Automatic approval**: Ask admin to enable auto-submit for sync user
2. **Manual approval**: Approve changes in Gerrit UI
3. **Admin bypass**: Use admin account with direct push permission

### Q: Can I force push to Gerrit?

**A:** Yes, with `--force` flag (included in the action). However, Gerrit may have push permission restrictions.

### Q: What if my Gerrit branch is protected?

**A:** Ask your Gerrit administrator to grant:
- Push permission on `refs/for/*` for code review flow, OR
- Direct push permission on `refs/heads/*` for automated sync bypass

### Q: Does this work with Gerrit SSH URLs?

**A:** Yes! The action detects Gerrit by:
1. URL patterns (includes "gerrit", port 29418, path /r/)
2. Works with both `https://` and `ssh://` URLs

### Q: Can I disable Gerrit mode?

**A:** The action auto-detects Gerrit. If it misidentifies your repo, you can:
- Ensure your Gerrit URL contains "gerrit" pattern
- Or file an issue for manual override input

## 📝 Implementation Details

Gerrit support is implemented in two modules:

- **`gerrit.js`** - Gerrit-specific functions:
  - `isGerritRepository()` - URL-based detection
  - `syncBranchesGerrit()` - Branch sync with refs/for/*
  - `syncTagsGerrit()` - Tag sync for Gerrit
  - `logGerritInfo()` - Gerrit-specific logging

- **`index.js`** - Main action with detection logic:
  - Detects repository type
  - Routes to appropriate sync functions
  - Maintains backward compatibility

## 🐛 Troubleshooting

### Error: "update for creating new commit object not permitted"

**Cause**: User doesn't have push permission

**Solutions**:
1. Check user permissions in Gerrit UI
2. Ask admin to grant `Push` permission on `refs/for/*`
3. Or grant direct push on `refs/heads/*`

### Error: "Change-Id in commit message required"

**Cause**: Gerrit requires Change-Id metadata

**Solution**: 
- The action handles this, but ensure Gerrit commit-msg hook is configured
- Or ask admin to allow push without Change-Id

### Changes not appearing in review queue

**Cause**: Possible permission or authentication issue

**Solutions**:
1. Verify HTTP credentials are correct
2. Check SSH key is properly set up (if using SSH)
3. Verify user has `ref/for/*` push permission
4. Check Gerrit logs for detailed error

## 📚 Resources

- [Gerrit Documentation](https://gerrit-review.googlesource.com/Documentation/)
- [Gerrit Push Workflow](https://gerrit-review.googlesource.com/Documentation/user-upload.html)
- [Gerrit Code Review](https://gerrit-review.googlesource.com/Documentation/intro-quick.html)
