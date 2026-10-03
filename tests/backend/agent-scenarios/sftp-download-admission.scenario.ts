import assert from 'node:assert/strict';
import { SftpDownloadAdmissionRegistry } from '../../../packages/backend/src/interfaces/http/sftp/download-admission.registry';

export const sftpDownloadAdmissionScenario = async () => {
  const admission = new SftpDownloadAdmissionRegistry({ maxPerUser: 2, maxTotal: 3 });
  const releaseUser1A = admission.acquire(1);
  const releaseUser1B = admission.acquire(1);
  assert.throws(() => admission.acquire(1), /下载并发过多/);

  const releaseUser2A = admission.acquire(2);
  assert.throws(() => admission.acquire(3), /下载并发过多/);

  releaseUser1A();
  releaseUser1A();
  const releaseUser2B = admission.acquire(2);
  assert.throws(() => admission.acquire(2), /下载并发过多/);

  releaseUser1B();
  releaseUser2A();
  releaseUser2B();
  const releasedCapacity = admission.acquire(3);
  releasedCapacity();

  return [
    { name: 'sftp_download_per_user_admission', value: 2, unit: 'downloads' },
    { name: 'sftp_download_global_admission', value: 3, unit: 'downloads' },
  ];
};
