import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function copyPagesAssets() {
  const assetNames = readdirSync("dist/assets").filter(
    (name) =>
      name === "index.css" || name === "index.js" || name.startsWith("flicon_"),
  );

  mkdirSync("assets", { recursive: true });
  for (const assetName of assetNames) {
    copyFileSync(`dist/assets/${assetName}`, `assets/${assetName}`);
  }
}

copyFileSync("source-index.html", "index.html");
run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--emptyOutDir=false"]);

copyFileSync("dist/index.html", "index.html");
copyPagesAssets();
