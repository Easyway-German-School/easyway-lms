# Production deployments

The production project is built from the repository root. Its `npm run build`
script installs the `prototype/` app, verifies the production database
migrations, builds Next.js, and lifts the result into Vercel's expected output
directory. Do not change Vercel's build command to `cd prototype && npm run
build`: that bypasses the root migration and output steps.

Production deploys are restricted to GitHub commits from `main`. Vercel ignores
automatic Git deployments from other branches, and the build refuses a
production deployment without GitHub repository, `main` branch, and commit-SHA
metadata. This prevents a stale feature branch, another IDE's uncommitted
snapshot, or an untracked local tree from silently replacing production.

## Working from multiple IDEs

- Use the same GitHub repository and a named branch in every IDE.
- Before starting work in another IDE, fetch and update that branch; do not
  publish a dirty working directory as a production deployment.
- Commit and push finished changes to a feature branch. Review and merge them
  into `main` once the targeted checks pass.
- Vercel production deploys from `main`. Do not use `vercel --prod` for routine
  releases; that sends a local source snapshot rather than the reviewed Git
  commit.
- If a production incident needs a rollback, use Vercel's rollback to the
  previous verified deployment, then fix the source on GitHub. Do not redeploy
  an old IDE workspace to "fix" production.

The deployment page and GitHub commit SHA are the source of truth for what is
live. A green build alone does not mean an older, unrelated branch is safe to
promote.
