#!/usr/bin/env node
/**
 * Post-build patch: Remove plugin-login requirement.
 *
 * In the index bundle, plugin capability sync uses statsig_default_enable_features.
 * When this object is null (commonly logged-out/offline), early return skips
 * syncing feature enablement and plugin-related features stay disabled.
 *
 * This patch does two things:
 * 1) Remove the null early-return and always send a feature override object.
 * 2) Force-enable plugin-related features by default when statsig data is absent.
 *
 * Usage:
 *   node scripts/patch-plugin-login.js [platform]   # Apply (unix/win/omit=all)
 *   node scripts/patch-plugin-login.js --check      # Dry-run
 */
const fs = require("fs");
const path = require("path");
const { locateBundles, relPath, SRC_DIR } = require("./patch-util");

const REPLACEMENTS = [
  {
    id: "remove_null_guard",
    find: "if(ri(`set-default-feature-overrides`,{overrides:n??null}),n==null)return;let e=Wxe(n),r=t.get(mi);",
    replace:
      "let e=Wxe(n);ri(`set-default-feature-overrides`,{overrides:e});let r=t.get(mi);",
  },
  {
    id: "force_plugin_feature_defaults",
    find: "function Wxe(e){let t={};for(let n of Hxe){let r=e[n];r!=null&&(t[n]=r)}return t}",
    replace:
      "function Wxe(e){let t={apps:!0,plugins:!0,tool_search:!0,tool_suggest:!0,tool_call_mcp_elicitation:!0};if(e==null)return t;for(let n of Hxe){let r=e[n];r!=null&&(t[n]=r)}return t}",
  },
];

function getLegacyBundle() {
  const legacyDir = path.join(SRC_DIR, "webview", "assets");
  if (!fs.existsSync(legacyDir)) return null;
  const files = fs.readdirSync(legacyDir).filter((f) => /^index-.*\.js$/.test(f));
  if (files.length === 0) return null;
  const target = files.length > 1 ? files.find((f) => f !== "main.js") || files[0] : files[0];
  return { platform: "legacy", path: path.join(legacyDir, target) };
}

function gatherBundles(platform) {
  const bundles = locateBundles({
    dir: "assets",
    pattern: /^index-.*\.js$/,
    platform,
  });

  // Also patch legacy flat bundle if it exists and wasn't already included.
  if (!platform) {
    const legacy = getLegacyBundle();
    if (legacy && !bundles.some((b) => b.path === legacy.path)) {
      bundles.push(legacy);
    }
  }

  return bundles;
}

function applyTextReplacements(source, isCheck) {
  let code = source;
  const actions = [];

  for (const rule of REPLACEMENTS) {
    if (code.includes(rule.replace)) {
      actions.push({ id: rule.id, status: "already_patched" });
      continue;
    }

    if (!code.includes(rule.find)) {
      actions.push({ id: rule.id, status: "not_found" });
      continue;
    }

    actions.push({ id: rule.id, status: isCheck ? "match" : "patched" });
    if (!isCheck) code = code.replace(rule.find, rule.replace);
  }

  return { code, actions };
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((a) => a === "unix" || a === "win");

  const bundles = gatherBundles(platform);
  if (bundles.length === 0) {
    console.error("[x] No index bundle found");
    process.exit(1);
  }

  let missingCount = 0;
  let changedCount = 0;

  for (const bundle of bundles) {
    console.log(`\n-- [${bundle.platform}] ${relPath(bundle.path)}`);
    const source = fs.readFileSync(bundle.path, "utf-8");
    const { code, actions } = applyTextReplacements(source, isCheck);

    for (const action of actions) {
      if (action.status === "not_found") {
        console.log(`   [!] ${action.id}: pattern not found`);
        missingCount++;
      } else if (action.status === "already_patched") {
        console.log(`   [ok] ${action.id}: already patched`);
      } else if (action.status === "match") {
        console.log(`   [?] ${action.id}: match`);
      } else if (action.status === "patched") {
        console.log(`   * ${action.id}: patched`);
      }
    }

    if (!isCheck && code !== source) {
      fs.writeFileSync(bundle.path, code, "utf-8");
      changedCount++;
      console.log("   [ok] plugin-login restriction removed");
    } else if (!isCheck) {
      console.log("   [ok] no write needed");
    }
  }

  if (missingCount > 0 && changedCount === 0) {
    console.error("\n[x] Target patterns not found in scanned bundles");
    process.exit(1);
  }
}

main();
