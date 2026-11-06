// Controlled adapter tests; no test delivery hooks are shipped in the product.
export { attachRdpFramePresenter } from '../src/features/remote-desktop/adapters/rdp-frame-presenter';

export { attachRdpAudioOutput } from '../src/features/remote-desktop/adapters/rdp-audio-output';

export { deliverRdpAudio } from './e2e-rdp-audio-extension';
