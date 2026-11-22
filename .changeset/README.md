# Changesets

Every pull request that changes a published package adds a changeset:

```bash
bun run changeset
```

Pick the packages, the bump (`patch`, `minor`, `major`) and write a line for the
changelog. The file it creates under `.changeset/` is committed with the change.

On `main`, the release workflow keeps a **Version Packages** pull request open
that applies every pending changeset. Merging it publishes the new versions to
npm. See "Releasing" in the root README.
