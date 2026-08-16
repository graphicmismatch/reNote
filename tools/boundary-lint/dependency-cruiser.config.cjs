// Enforces the workspace's package boundaries at the CI level: an illegal
// import fails the build, rather than relying on code review to catch it.
// See the project plan's "structural, not conventional" requirement.
//
// - packages/core has zero in-repo dependencies (everything else depends on
//   it, never the reverse).
// - canvas-engine/text-editor/ui/storage-client/shortcuts may each depend on
//   core only — never on one another. Only apps/desktop may depend on all
//   of them.
const NON_CORE_PACKAGES = ["canvas-engine", "text-editor", "ui", "storage-client", "shortcuts"];

const noSiblingImportRules = NON_CORE_PACKAGES.map((pkg) => {
  const siblings = NON_CORE_PACKAGES.filter((other) => other !== pkg);
  return {
    name: `no-sibling-import-from-${pkg}`,
    comment: `packages/${pkg} may depend on @renote/core only. Sibling packages must be composed together in apps/desktop instead of depending on each other directly.`,
    severity: "error",
    from: { path: `^packages/${pkg}/` },
    to: { path: `^packages/(${siblings.join("|")})/` },
  };
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-has-no-workspace-deps",
      comment:
        "packages/core is the shared vocabulary every other package depends on; it must never depend back on any of them.",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "^(packages|apps)/(?!core/)" },
    },
    ...noSiblingImportRules,
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.test\\.(ts|tsx)$" },
    tsConfig: { fileName: "tsconfig.boundary-lint.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types"],
    },
  },
};
