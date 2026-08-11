/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
// [TRAXNODE] 邀请返利页 API（后端 selfRoute：GET /api/user/aff/rebates + GET /api/user/aff/invitees，
// 分页沿用 common.PageInfo 的 p/page_size 约定）
import { api } from '@/lib/api'

import type { AffInviteesData, AffRebatesData, ApiResponse } from './types'

export interface AffPageParams {
  p: number
  page_size: number
}

export async function getAffRebates(
  params: AffPageParams
): Promise<ApiResponse<AffRebatesData>> {
  const res = await api.get(
    `/api/user/aff/rebates?p=${params.p}&page_size=${params.page_size}`
  )
  return res.data
}

export async function getAffInvitees(
  params: AffPageParams
): Promise<ApiResponse<AffInviteesData>> {
  const res = await api.get(
    `/api/user/aff/invitees?p=${params.p}&page_size=${params.page_size}`
  )
  return res.data
}
