import express from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import { getAllProxies, getProxyById, createProxy, updateProxy, deleteProxy } from './proxies.controller';

const router = express.Router();

router.use(isAuthenticated);

router.get('/', getAllProxies);
router.get('/:id', getProxyById);
router.post('/', createProxy);
router.put('/:id', updateProxy);
router.delete('/:id', deleteProxy);

export default router;
