import {config as base} from "./wdio.conf.mts";
export const config={...base,specs:["./specs/usability.e2e.ts"],mochaOpts:{ui:"bdd",timeout:120000}};
