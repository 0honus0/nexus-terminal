import { Router } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import { createDownloadTicket, downloadFile, downloadDirectory } from './sftp.controller';

const router = Router();

// Authenticated browser action creates a short-lived ticket. The resulting
// download URL can then be handed to an external download manager without
// exposing the browser session cookie.
router.post('/download-ticket', isAuthenticated, createDownloadTicket);

// GET/HEAD accepts either a normal authenticated browser session or a valid
// short-lived download ticket. Authentication is enforced inside the handler.
router.get('/download', downloadFile);

router.get('/download-directory', isAuthenticated, downloadDirectory);

export default router;
