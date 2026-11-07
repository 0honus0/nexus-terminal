import { definePlugin } from './sdk.mjs';
export default definePlugin((plugin) => {
 plugin.register({kind:'app', key:plugin.identity.package.packageId+'.run', contract:plugin.identity.package.packageId,
 apiVersion:1, summary:'Deterministic fixture App', instructions:'Complete without a model.',
 inputSchemaJson:'{"type":"object"}', resultSchemaJson:'{"type":"object"}', capabilities:[], tags:[], execution:'managed'},
 async (_input, context) => ({kind:'complete', outputs:[await context.content.put('answer','OK','text/plain')]}));
});
