import { copyFileSync, mkdirSync } from "node:fs";
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

copyFileSync("source-index.html", "index.html");
run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--emptyOutDir=false"]);

mkdirSync("assets", { recursive: true });
copyFileSync("dist/index.html", "index.html");
copyFileSync("dist/assets/index.css", "assets/index.css");
copyFileSync("dist/assets/index.js", "assets/index.js");
