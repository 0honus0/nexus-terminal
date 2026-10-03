import assert from 'node:assert/strict';
import { SftpDownloadAdmissionRegistry } from '../../../packages/backend/src/interfaces/http/sftp/download-admission.registry';

export const sftpDownloadAdmissionScenario = async () => {
  const admission = new SftpDownloadAdmissionRegistry({ maxTotal: 3 });
  const releaseUser1A = admission.acquire();
  const releaseUser1B = admission.acquire();
  const releaseUser2A = admission.acquire();
  assert.throws(() => admission.acquire(), /下载并发过多/);

  releaseUser1A();
  releaseUser1A();
  const releaseUser2B = admission.acquire();
  assert.throws(() => admission.acquire(), /下载并发过多/);

  releaseUser1B();
  releaseUser2A();
  releaseUser2B();
  const releasedCapacity = admission.acquire();
  releasedCapacity();

  return [{ name: 'sftp_download_global_admission', value: 3, unit: 'downloads' }];
};
