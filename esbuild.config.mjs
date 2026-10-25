import {build} from "esbuild";
await build({
  entryPoints:["src/main.ts"],bundle:true,format:"cjs",platform:"node",
  target:"es2022",outfile:"main.js",external:["obsidian","electron","node:*"],
  logLevel:"info",sourcemap:false,minify:true
});
