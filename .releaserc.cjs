/**
 * semantic-release configuration
 *
 * - main: stable releases (e.g. 1.2.3)
 * - dev: prerelease channel "rc" (e.g. 1.2.4-rc.1) + GitHub prerelease
 */
module.exports = {
	branches: [
		"main",
		{
			name: "dev",
			channel: "rc",
			prerelease: "rc",
		},
	],
	tagFormat: "v${version}",
	plugins: [
		"@semantic-release/commit-analyzer",
		"@semantic-release/release-notes-generator",
		[
			"@semantic-release/changelog",
			{
				changelogFile: "CHANGELOG.md",
			},
		],
		[
			"@semantic-release/npm",
			{
				npmPublish: false,
			},
		],
		"@semantic-release/github",
		[
			"@semantic-release/git",
			{
				assets: ["CHANGELOG.md", "package.json", "pnpm-lock.yaml"],
				message:
					"chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
			},
		],
	],
};
