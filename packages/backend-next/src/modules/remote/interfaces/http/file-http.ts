import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { MachineSftpFailure } from '../../../../platform/ssh/ssh-port.js';
import { RemoteHostKeyUntrustedError } from '../../sessions/model/session-errors.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import { RemoteFileFailure, type FileInfo, type FileEntry } from '../../files/model/file-types.js';
import type { RemoteFileService } from '../../files/service/file-service.js';
import { REMOTE_FILE_MAX_LIST_ENTRIES, REMOTE_FILE_MAX_METADATA_BYTES, REMOTE_FILE_MAX_TEXT_BYTES,
 REMOTE_FILE_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/remote/files/values';
import type { RemoteFileErrorCode } from '@nexus-terminal/shared/remote/files/values';
import type { RemoteFileInfo } from '@nexus-terminal/shared/remote/files/model';
import type { RemoteFileErrorResponse, RemoteFileListResponse, RemoteFileOpenResponse,
 RemoteFileTextResponse, RemoteFileStatResponse, RemoteFileCloseResponse } from '@nexus-terminal/shared/remote/files/http';
import { InvalidRemoteFilePayload, readRemoteFileOpenRequest, readRemoteFilePathRequest } from '@nexus-terminal/shared/remote/files/http-codec';

const ROOT = '/api/v1/remote/files';

function toInfo(value: FileInfo): RemoteFileInfo {
 return { size: value.size, mode: value.mode, modifiedAt: value.modifiedAt, kind: value.kind };
}
function toEntry(value: FileEntry): RemoteFileListResponse['entries'][number] {
 return { name: value.name, info: toInfo(value.info) };
}
function id(ctx: HttpRouteContext): string {
 const value = ctx.params.id;
 if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value))
  throw new RemoteFileFailure('invalid_input');
 return value;
}
function errorCode(error: unknown): RemoteFileErrorCode {
 if (error instanceof RemoteFileFailure) return error.code;
 if (error instanceof RemoteHostKeyUntrustedError) return 'host_key_untrusted';
 if (error instanceof TargetOperationError) {
  if (error.code === 'conflict') return 'stale_target';
  if (error.code === 'reference_not_found') return 'not_found';
 }
 if (error instanceof MachineSftpFailure && error.reason === 'limit_exceeded') return 'limit_exceeded';
 return 'remote_unavailable';
}
function status(code: RemoteFileErrorCode): number {
 switch(code) {
  case 'invalid_input': return 400;
  case 'unauthenticated': return 401;
  case 'forbidden': return 403;
  case 'not_found': return 404;
  case 'stale_target': return 409;
  case 'host_key_untrusted': return 422;
  case 'limit_exceeded': return 413;
  case 'not_text': return 415;
  case 'remote_unavailable': return 503;
 }
}
function send(ctx: HttpRouteContext, code: number, body: unknown): void {
 if (Buffer.byteLength(JSON.stringify(body), 'utf8') > REMOTE_FILE_MAX_RESPONSE_BYTES)
  throw new RemoteFileFailure('limit_exceeded');
 ctx.send(code, body);
}
function route(method: HttpRoute['method'], path: string, action: (ctx: HttpRouteContext, signal: AbortSignal) => Promise<void>): HttpRoute {
 return { method, path: ROOT + path, async handle(ctx) {
  const controller = new AbortController();
  const aborted = () => controller.abort();
  const disconnected = () => { if (!ctx.response.writableEnded) controller.abort(); };
  ctx.request.once('aborted',aborted);
  ctx.response.once('close',disconnected);
  try {
   if (ctx.query.size) throw new RemoteFileFailure('invalid_input');
   await action(ctx,controller.signal);
  } catch (error) {
   if (error instanceof HttpInputFailure) throw error;
   const code = error instanceof InvalidRemoteFilePayload ? 'invalid_input' : errorCode(error);
   send(ctx,status(code),{code} satisfies RemoteFileErrorResponse);
  } finally {
   ctx.request.off('aborted',aborted);
   ctx.response.off('close',disconnected);
  }
 }};
}

/** Files have their own HTTP owner, not the PTY protocol stream. */
export function createRemoteFileHttpRoutes(files: RemoteFileService): HttpRoute[] {
 return [
  route('POST','/resources',async (ctx,signal)=>{
   const input = readRemoteFileOpenRequest(await ctx.json());
   const opened = await files.open(ctx.cookie('nexus_session'), input.targetId,signal);
   if (signal.aborted) {
    await files.release(ctx.cookie('nexus_session'),opened.id);
    return;
   }
   send(ctx,201,{id:opened.id,targetId:opened.targetId,configurationFingerprint:opened.fingerprint} satisfies RemoteFileOpenResponse);
  }),
  route('DELETE','/resources/:id',async (ctx)=>{
   await files.release(ctx.cookie('nexus_session'),id(ctx));
   send(ctx,200,{closed:true} satisfies RemoteFileCloseResponse);
  }),
  route('POST','/resources/:id/list',async(ctx,signal)=>{
   const input=readRemoteFilePathRequest(await ctx.json());
   const entries=await files.list(ctx.cookie('nexus_session'),id(ctx),input.path,REMOTE_FILE_MAX_LIST_ENTRIES,REMOTE_FILE_MAX_METADATA_BYTES,signal);
   send(ctx,200,{complete:true,entries:entries.map(toEntry)} satisfies RemoteFileListResponse);
  }),
  route('POST','/resources/:id/stat',async(ctx,signal)=>{
   const input=readRemoteFilePathRequest(await ctx.json());
   const info=await files.stat(ctx.cookie('nexus_session'),id(ctx),input.path,true,signal);
   send(ctx,200,{info:toInfo(info)} satisfies RemoteFileStatResponse);
  }),
  route('POST','/resources/:id/lstat',async(ctx,signal)=>{
   const input=readRemoteFilePathRequest(await ctx.json());
   const info=await files.stat(ctx.cookie('nexus_session'),id(ctx),input.path,false,signal);
   send(ctx,200,{info:toInfo(info)} satisfies RemoteFileStatResponse);
  }),
  route('POST','/resources/:id/read-text',async(ctx,signal)=>{
   const input=readRemoteFilePathRequest(await ctx.json());
   const result=await files.readText(ctx.cookie('nexus_session'),id(ctx),input.path,REMOTE_FILE_MAX_TEXT_BYTES,signal);
   send(ctx,200,{info:toInfo(result.info),bytes:result.bytes,text:result.text} satisfies RemoteFileTextResponse);
  }),
 ];
}
