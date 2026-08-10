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
// [TRAXNODE] 管理员返利管理页 API（后端 /api/aff_rebate 组，AdminAuth）：
// GET /api/aff_rebate/（明文列表 + keyword/status/trade_no 筛选 + stats 聚合）
// POST /api/aff_rebate/:id/reverse（冲销执行，body 带选填 reason）
import { api } from '@/lib/api'

import type {
  AffRebateAdminData,
  ApiResponse,
  ReverseAffRebateData,
} from './types'

export interface AffRebateAdminParams {
  p: number
  page_size: number
  keyword?: string
  status?: string
  trade_no?: string
}

export async function getAffRebateLogs(
  params: AffRebateAdminParams
): Promise<ApiResponse<AffRebateAdminData>> {
  const search = new URLSearchParams({
    p: String(params.p),
    page_size: String(params.page_size),
  })
  if (params.keyword) search.set('keyword', params.keyword)
  if (params.status) search.set('status', params.status)
  if (params.trade_no) search.set('trade_no', params.trade_no)
  const res = await api.get(`/api/aff_rebate/?${search.toString()}`)
  return res.data
}

export async function reverseAffRebate(
  id: number,
  reason: string
): Promise<ApiResponse<ReverseAffRebateData>> {
  const res = await api.post(`/api/aff_rebate/${id}/reverse`, { reason })
  return res.data
}
