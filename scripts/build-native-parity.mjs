import {build} from 'esbuild';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
if(!process.argv[2])throw new Error('Usage: node scripts/build-native-parity.mjs <chatgpt-plugin-path>');
const tunnel=resolve(process.argv[2]);
const out=resolve('tests/desktop/artifacts');mkdirSync(out,{recursive:true});
const result=await build({entryPoints:[join(tunnel,'src/connection-popover.ts')],bundle:true,write:false,platform:'browser',format:'iife',globalName:'NativeChatGPT',target:'es2022',plugins:[{name:'real-obsidian-controls',setup(build){
 build.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'native'}));
 build.onLoad({filter:/.*/,namespace:'native'},()=>({contents:'module.exports=globalThis.__parityObsidian;',loader:'js'}));
}}]});
writeFileSync(join(out,'chatgpt-native.js'),result.outputFiles[0].text);
writeFileSync(join(out,'chatgpt-native.css'),readFileSync(join(tunnel,'styles.css')));
console.log('Built production ChatGPT UI with actual Obsidian components; only the network/process host will be simulated.');
