import { Router } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import { getLocalSystemStatus } from './system-status.service';

const router = Router();

router.use(isAuthenticated);

router.get('/status', async (_req, res) => {
  try {
    res.json(await getLocalSystemStatus());
  } catch (error: any) {
    console.error('[SystemStatus] Failed to collect local system status:', error);
    res.status(500).json({ message: error?.message || 'Failed to collect local system status.' });
  }
});

export default router;
