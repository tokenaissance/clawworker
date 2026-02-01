import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { cloudflare } from "@cloudflare/vite-plugin"
import { getConfigVersion } from "./scripts/get-version.js"

// Get config version at build time
const CONFIG_VERSION = getConfigVersion()
console.log(`[Build] CONFIG_VERSION: ${CONFIG_VERSION}`)

export default defineConfig({
	base: "/_admin/",
	define: {
		// Inject version as global constant available in Worker code
		__CONFIG_VERSION__: JSON.stringify(CONFIG_VERSION),
	},
	plugins: [
		react(),
		cloudflare({
			configPath: "./wrangler.jsonc",
			persistState: false,
		}),
	],
})
