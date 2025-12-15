import { execSync } from "node:child_process";

if (process.env.WORKERS_CI_BRANCH === "main") {
	console.log("Skipping versions:upload because WORKERS_CI_BRANCH=main");
	process.exit(0);
}

execSync("pnpm run predeploy:preview", { stdio: "inherit" });
execSync("wrangler versions upload --config wrangler.preview.jsonc", {
	stdio: "inherit",
});
