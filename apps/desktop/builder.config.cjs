module.exports = {
  appId: "io.github.cynicalight.neoread",
  productName: "NeoRead",
  directories: { output: "../../release" },
  files: ["dist/**/*", "package.json"],
  extraResources: [{ from: "staging", to: ".", filter: ["**/*"] }],
  asar: true,
  // Keep maximum compression for Windows NSIS.
  compression: "maximum",
  npmRebuild: false,
  publish: null,
  protocols: [{ name: "NeoRead", schemes: ["neoread"] }],
  mac: {
    compression: "normal",
    // The zip is the Squirrel.Mac in-place update payload.
    target: ["dmg", "zip"],
    category: "public.app-category.books",
    icon: "../../assets/icons/macos/icon.icns",
    identity: "-",
    // Replaces the ad-hoc identity with the fixed release certificate when available.
    sign: (options) => require("./mac-sign.cjs")(options),
    hardenedRuntime: false,
    notarize: false,
    artifactName:
      process.arch === "x64"
        ? "NeoRead-${version}-mac-intel-x64.${ext}"
        : "NeoRead-${version}-mac-${arch}.${ext}",
  },
  dmg: {
    sign: false,
    // scripts/package.mjs recompresses this uncompressed image to ULMO (LZMA),
    // which the builder schema does not accept. The blockmap would be stale.
    format: "UDRO",
    writeUpdateInfo: false,
  },
  win: {
    target: ["nsis"],
    icon: "../../assets/icons/windows/icon.ico",
    // Skip only code signing; resource editing still embeds the icon and version info.
    signExecutable: false,
    artifactName: "NeoRead-${version}-win-${arch}.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },
};
