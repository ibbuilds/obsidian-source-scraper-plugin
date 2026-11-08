import {config as base} from "./wdio.conf.mts";
export const config={...base,specs:["./specs/usability.e2e.ts","./specs/adapters.e2e.ts","./specs/curation.e2e.ts"],mochaOpts:{ui:"bdd",timeout:120000}};
