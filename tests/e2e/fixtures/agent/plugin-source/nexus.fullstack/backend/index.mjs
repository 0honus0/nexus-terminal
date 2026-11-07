import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { definePlugin, PluginCapabilityFailure } from './sdk.mjs';

const assertDenied = (probe, expectedPermission) => {
 try { probe(); }
 catch (error) {
  if (error?.code === 'ERR_ACCESS_DENIED' && error.permission === expectedPermission) return true;
  throw error;
 }
 throw new Error('FULLSTACK_PERMISSION_NOT_ENFORCED:' + expectedPermission);
};

export default definePlugin((plugin) => {
 const status = {state:'active',source:'backend',appId:plugin.identity.appId, version:plugin.identity.package.version,
 protocolVersion:plugin.identity.protocol,
 fileReadDenied:assertDenied(() => fs.readFileSync('/etc/passwd','utf8'),'FileSystemRead'),
 childProcessDenied:assertDenied(() => spawnSync(process.execPath,['--version']),'ChildProcess')};
 plugin.register({kind:'app',key:'nexus.fullstack.run',contract:'nexus.fullstack',apiVersion:1,
 summary:'Full-stack isolated backend',instructions:'Persist the instance probe on an explicitly authorized Run; later Runs read the same private namespace.',
 inputSchemaJson:'{"type":"object"}',resultSchemaJson:'{"type":"object"}',capabilities:['plugin.invoke'],tags:[],execution:'managed'},
 async (_input, context) => {
  const current = await context.storage.read('fixture.v1','backend.status');
  if (!current) {
   const receipt = await context.storage.write({operationKey:'backend-status',namespace:'fixture.v1',key:'backend.status',expectedRevision:0,documentJson:JSON.stringify(status)});
   if (receipt.kind !== 'completed') throw new PluginCapabilityFailure(receipt.kind === 'rejected' ? receipt.code : 'operation_unknown');
  }
  const saved = await context.storage.read('fixture.v1','backend.status');
  if (!saved?.documentJson) throw new Error('BACKEND_PROBE_NOT_SAVED');
  await context.run.append({key:'status',index:0,text:saved.documentJson});
  return {kind:'complete',outputs:[await context.content.put('status',saved.documentJson,'application/json')]};
 });
});
