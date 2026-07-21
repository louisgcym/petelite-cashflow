import { Tx, Pending } from './types';

const K_TX = 'PetElite Pharma_tx';
const K_PENDING = 'PetElite Pharma_pending';
const K_OPENING = 'PetElite Pharma_opening';

export const loadTx = (): Tx[] => JSON.parse(localStorage.getItem(K_TX) || '[]');
export const saveTx = (t: Tx[]) => localStorage.setItem(K_TX, JSON.stringify(t));

export const loadPending = (): Pending[] => JSON.parse(localStorage.getItem(K_PENDING) || '[]');
export const savePending = (p: Pending[]) => localStorage.setItem(K_PENDING, JSON.stringify(p));

export const loadOpening = (): number => Number(localStorage.getItem(K_OPENING) || '370188.09');
export const saveOpening = (n: number) => localStorage.setItem(K_OPENING, String(n));
