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
// [TRAXNODE] 管理员返利管理页类型定义（对应后端 controller/aff_rebate.go 管理员侧 API 契约）。
// 与用户侧 features/invitation 零共享（明文/脱敏物理隔离，design §3.3b），状态枚举有意重复定义。

/** Rebate log status enum (mirrors backend model.AffRebateStatus*) */
export const AFF_REBATE_STATUS = {
  FROZEN: 1,
  CREDITED: 2,
  REVERSED: 3,
} as const

/** Status filter values for the faceted filter / route search schema */
export const AFF_REBATE_FILTER_VALUES = ['1', '2', '3'] as const

/** Raw aff_rebate_logs record (flattened AffRebateLog JSON) */
export interface AffRebateLogRecord {
  id: number
  trade_no: string
  inviter_id: number
  invitee_id: number
  /** Paid amount snapshot (USD) */
  money: number
  /** Rebate percentage snapshot at credit time */
  percentage: number
  /** Rebate amount in quota units */
  rebate_quota: number
  status: number
  /** Unix seconds; unlock time for frozen records */
  unlock_time: number
  /** Unix seconds */
  create_time: number
  /** Unix seconds; 0 when not reversed */
  reverse_time: number
  /** Admin user id who reversed the record; 0 when not reversed */
  reverse_by: number
  /** Optional reversal note (audit column) */
  reverse_reason: string
}

/** Admin list row: log record + plaintext usernames (admin-only view) */
export interface AffRebateAdminItem extends AffRebateLogRecord {
  inviter_username: string
  invitee_username: string
  reverse_by_username?: string
}

/** Per-status aggregate for the page-head overview badges (whole-table scope) */
export interface AffRebateStatusStat {
  status: number
  count: number
  quota: number
}

export interface AffRebateAdminData {
  page: number
  page_size: number
  total: number
  items: AffRebateAdminItem[] | null
  /** null when the table is empty — callers must tolerate (批次 C 备案) */
  stats: AffRebateStatusStat[] | null
}

export interface ReverseAffRebateData {
  already_reversed: boolean
  item: AffRebateLogRecord
}

export interface ApiResponse<T = unknown> {
  success?: boolean
  message?: string
  data?: T
}
