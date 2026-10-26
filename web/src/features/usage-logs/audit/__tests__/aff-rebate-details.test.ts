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
// [TRAXNODE] Audit detail dialog for the referral rebate reversal
// (controller/aff_rebate.go, action aff_rebate.reverse): the inviter is the
// target and the rebate record id is not mistaken for the target id.
import { createInstance } from 'i18next'
import { describe, expect, test } from 'vitest'

import zh from '@/i18n/locales/zh.json'

import type { AuditLog } from '../api'
import { buildAuditDetails } from '../lib/audit-details'

const entry: AuditLog = {
  event_id: 'audit-event-aff-rebate',
  user_id: 1427,
  username: 'trax46c_admn',
  actor_role: 10,
  created_at: 1792944000,
  category: 'operation',
  action: 'aff_rebate.reverse',
  token_ref: '',
  auth_method: 'session',
  ip: '127.0.0.1',
  user_agent: '',
  method: 'POST',
  route: '/api/aff_rebate/:id/reverse',
  status: 200,
  success: true,
  request_id: 'audit-request-aff-rebate',
  content:
    'Reversed referral rebate #21 of user trax46c_inv_a (order trax46c-spare2, rebate ＄0.050000, deducted ＄0.050000, reason: duplicate order)',
  other: {
    admin_info: {
      admin_id: 1427,
      admin_username: 'trax46c_admn',
      admin_role: 10,
      auth_method: 'session',
    },
    op: {
      action: 'aff_rebate.reverse',
      params: {
        rebate_id: 21,
        trade_no: 'trax46c-spare2',
        quota: '＄0.050000',
        deducted: '＄0.050000',
        reverse_reason: 'duplicate order',
        username: 'trax46c_inv_a',
        target_user_id: 1425,
      },
    },
  },
}

// Mirrors the options of src/i18n/config.ts that affect rendering.
async function createI18n() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'zh',
    resources: { zh },
    nsSeparator: false,
    interpolation: { escapeValue: false },
  })
  return i18n
}

describe('aff_rebate.reverse audit details', () => {
  test('shows the inviter as the target and labels every rebate field', async () => {
    const i18n = await createI18n()
    const detail = buildAuditDetails(entry, i18n.t)

    expect(detail.summary).toBe(
      '冲销用户 trax46c_inv_a 的邀请返利 #21（订单号 trax46c-spare2，返利 ＄0.050000，扣回 ＄0.050000，原因：duplicate order）'
    )
    expect(detail.target).toBe('trax46c_inv_a')
    expect(detail.actor).toBe('trax46c_admn (ID: 1427)')

    const values = detail.fields.map((field) => field.value)
    expect(values).toEqual([
      21,
      'trax46c-spare2',
      '＄0.050000',
      '＄0.050000',
      'duplicate order',
      1425,
    ])
    expect(detail.fields.map((field) => field.label)).toEqual([
      '返利记录 ID',
      '订单号',
      '额度',
      '扣回金额',
      '冲销原因',
      '用户 ID',
    ])
  })
})
