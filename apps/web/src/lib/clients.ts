import { ApiClient } from './api';
import type { StaffSession, TenantSession } from './types';

/** API para a equipa (proprietários, gestores, contabilistas). */
export const staffApi = new ApiClient<StaffSession>('/auth/refresh', '/auth/logout');

/** API para o portal do inquilino. */
export const portalApi = new ApiClient<TenantSession>('/portal/auth/refresh', '/portal/auth/logout');
