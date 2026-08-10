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
// [TRAXNODE] 邀请返利页类型定义（对应后端 controller/aff_rebate.go 用户侧 API 契约）

/** Rebate log status enum (mirrors backend model.AffRebateStatus*) */
export const AFF_REBATE_STATUS = {
  FROZEN: 1,
  CREDITED: 2,
  REVERSED: 3,
} as const

export interface AffRebateItem {
  id: number
  /** Masked by the backend (maskUsername); plaintext never leaves the server */
  invitee_username: string
  /** Paid amount snapshot (USD) */
  money: number
  /** Rebate amount in quota units */
  rebate_quota: number
  status: number
  /** Unix seconds; unlock time for frozen records */
  unlock_time: number
  /** Unix seconds */
  create_time: number
}

export interface AffRebatesData {
  page: number
  page_size: number
  total: number
  items: AffRebateItem[] | null
  /** SUM(rebate_quota) over frozen (status=1) records */
  frozen_total: number
}

export interface AffInviteeItem {
  /** Masked by the backend */
  username: string
  /** Unix seconds (users.created_at) */
  created_at: number
  /** Credited-only (status=2) contribution aggregate, in quota units */
  contributed_quota: number
}

export interface AffInviteesData {
  page: number
  page_size: number
  total: number
  items: AffInviteeItem[] | null
}

export interface ApiResponse<T = unknown> {
  success?: boolean
  message?: string
  data?: T
}

/** Subset of the getSelf DTO consumed by the invitation page */
export interface SelfUserData {
  id: number
  username: string
  quota: number
  aff_quota: number
  aff_history_quota: number
  aff_count: number
  inviter_id: number
}
