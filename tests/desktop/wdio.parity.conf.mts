import {config as base} from "./wdio.conf.mts";
export const config={...base,specs:["./specs/native-parity.e2e.ts"],mochaOpts:{ui:"bdd",timeout:240000}};
