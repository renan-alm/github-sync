# Build stage
FROM node:20.11-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
# Using ci instead of install for deterministic builds in CI
RUN npm ci --only=production && npm cache clean --force

# Runtime stage
FROM node:20.11-alpine

LABEL maintainer="Renan Alm <renan-alm@github.com>"
LABEL description="GitHub Action for syncing repositories across different SCM providers"

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs index.js package*.json lib/ ./

# Install git (required for git operations)
RUN apk add --no-cache git

# Switch to non-root user
USER nodejs

# Health check (validates Node.js is working)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('ok')" || exit 1

# Default command
ENTRYPOINT ["node"]
CMD ["index.js"]
