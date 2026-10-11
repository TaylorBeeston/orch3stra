import {runtimeConfig} from './runtime-config.mjs';
import {join,resolve} from 'node:path';
/** One interpreter by default. H3_PYTHON overrides historical per-feature settings. */
export function sharedPython(env=process.env){return runtimeConfig(env).python;}
export function voicePython(env=process.env){return env.H3_PYTHON||env.H3_VOICE_PYTHON||sharedPython(env);}
