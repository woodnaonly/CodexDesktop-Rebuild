#!/usr/bin/env node
/**
 * Post-build patch: Remove plugin-login requirement.
 *
 * In the index bundle, plugin capability sync uses statsig_default_enable_features.
 * When this object is null (commonly logged-out/offline), early return skips
 * syncing feature enablement and plugin-related features stay disabled.
 *
 * This patch does four things:
 * 1) Remove the null early-return and always send a feature override object.
 * 2) Force-enable plugin-related features by default when statsig data is absent.
 * 3) Stop API-key auth from hiding the Plugins/Apps sidebar entry.
 * 4) Remove the disabled Plugins sidebar item and its sign-in tooltip.
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
  {
    id: "force_sidebar_plugins_for_api_key",
    find: "{authMethod:D}=zp(),O=$f(`533078438`),k=D===`apikey`,A=O&&k",
    replace: "{authMethod:D}=zp(),O=$f(`533078438`),k=D===`apikey`,A=!1",
  },
  {
    id: "show_plugins_label_for_api_key",
    find: "ee=Ha({hostId:me})&&!k",
    replace: "ee=Ha({hostId:me})",
  },
  {
    id: "remove_sidebar_disabled_plugins_tooltip",
    find: "A?(0,$.jsx)(Lh,{tooltipContent:(0,$.jsx)(Y,{id:`sidebarElectron.pluginsDisabledTooltip`,defaultMessage:`Please sign in with ChatGPT to use plugins`,description:`Tooltip shown when API-key users hover the disabled Plugins nav item in the sidebar`}),side:`right`,sideOffset:20,children:(0,$.jsx)(`div`,{children:(0,$.jsx)(Hb,{icon:fu,onClick:()=>{},disabled:!0,label:(0,$.jsx)(Y,{id:`sidebarElectron.pluginsRouteNavLink`,defaultMessage:`Plugins`,description:`Disabled nav link shown to API-key users under Skills in the sidebar`})})})}):null,",
    replace: "",
    assertAbsent: "sidebarElectron.pluginsDisabledTooltip",
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
    if (code.includes(rule.find)) {
      actions.push({ id: rule.id, status: isCheck ? "match" : "patched" });
      if (!isCheck) code = code.replace(rule.find, rule.replace);
      continue;
    }

    if (rule.replace !== "" && code.includes(rule.replace)) {
      actions.push({ id: rule.id, status: "already_patched" });
      continue;
    }

    {
      if (rule.assertAbsent && !code.includes(rule.assertAbsent)) {
        actions.push({ id: rule.id, status: "already_patched" });
        continue;
      }
      actions.push({ id: rule.id, status: "not_found" });
      continue;
    }
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
