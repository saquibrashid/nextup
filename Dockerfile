# nextup — one image, one process, one port (ADR-0003, specs/api.md §1).
#
# The Express API and the built React SPA are served by the SAME Node process
# on the SAME port. That is not a packaging convenience: with a single origin
# there is no cross-origin request to configure, which is why the API carries
# no CORS handling at all (`T-API-001`).
#
# The base image is pinned BY DIGEST, not by tag (specs/security.md §8). A tag
# is mutable — `node:20-alpine` silently becomes a different image, so a build
# that passed CI is not the build that ships. Refresh the digest deliberately,
# in its own commit, in both stages together.
ARG NODE_IMAGE=node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

# Registry override for networks where the public npm registry is unreachable
# (for example a corporate proxy). The DEFAULT must stay the public registry:
# GitHub-hosted runners cannot resolve an internal proxy, and an internal URL
# committed as the default would both break CI and publish internal infra.
# Pass it per build instead:
#   docker build --build-arg NPM_REGISTRY=https://<proxy>/npm/ -t nextup:local .
ARG NPM_REGISTRY=https://registry.npmjs.org/

# ── Stage 1: build ─────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Manifests first so the dependency layer is cached independently of source.
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tools/eslint-plugin-nextup/package.json tools/eslint-plugin-nextup/

# `npm ci` (not `install`) — the lockfile is the source of truth, and a build
# that can silently resolve a different tree is not reproducible.
ARG NPM_REGISTRY
RUN npm config set registry "${NPM_REGISTRY}" && npm ci

COPY . .
RUN npm run build

# ── Stage 2: runtime ───────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ARG NPM_REGISTRY

COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# npm ci requires every declared workspace directory to exist, even one that
# contributes nothing at runtime.
COPY tools/eslint-plugin-nextup/package.json tools/eslint-plugin-nextup/

# Production dependencies for the API workspace ONLY. A plain
# `npm ci --omit=dev` at the root still drags in dev-only workspaces and their
# peer dependencies (eslint, playwright) — tooling that runs nothing here and
# is pure attack surface. `--ignore-scripts` stops a transitive postinstall
# executing during the image build.
RUN npm config set registry "${NPM_REGISTRY}" \
  && npm ci --omit=dev --omit=peer --omit=optional --ignore-scripts --workspace @nextup/api --include-workspace-root \
  && npm cache clean --force \
  && rm -f /home/node/.npmrc /root/.npmrc

# Compiled output only — no TypeScript sources ship.
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist

# `node` is an unprivileged user that already exists in the base image.
USER node

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
