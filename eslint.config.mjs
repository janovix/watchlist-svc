import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
	{
		ignores: [
			"**/*.d.ts",
			"coverage/**",
			"dist/**",
			"node_modules/**",
			".wrangler/**",
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.node,
				...globals.browser,
			},
		},
		rules: {
			"no-console": "off",
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
		},
	},
	{
		files: ["tests/**/*.{ts,tsx,mts,cts}"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
	prettier,
);
