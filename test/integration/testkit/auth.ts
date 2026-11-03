import { randomBytes } from 'node:crypto';
import type { Principal } from '../../../src/auth/principal';

export const clientPrincipal = {
  id: 'd6d40f22-49e2-40a9-9a54-1f35f2c12a31',
  role: 'client',
  renterId: 'd1443a2b-cb78-4fe4-9187-ac22d3f03e14',
} as const satisfies Principal;
export const otherPrincipal = {
  id: '6d52404b-f438-477b-8ef5-ec075f462f53',
  role: 'client',
  renterId: '3b34793d-f26d-462f-8a7f-2d7e2530db1e',
} as const satisfies Principal;
export const staffPrincipal = {
  id: '1659e83b-a840-4a3a-bd3f-901e869047cb',
  role: 'staff',
} as const satisfies Principal;
const token = () => randomBytes(32).toString('hex');
export const testIdentities = [
  { ...clientPrincipal, token: token() },
  { ...otherPrincipal, token: token() },
  { ...staffPrincipal, token: token() },
];
export const clientAuthorization = `Bearer ${testIdentities[0].token}`;
export const otherAuthorization = `Bearer ${testIdentities[1].token}`;
export const staffAuthorization = `Bearer ${testIdentities[2].token}`;
