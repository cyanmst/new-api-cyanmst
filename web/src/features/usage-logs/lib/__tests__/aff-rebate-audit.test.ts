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
// [TRAXNODE] Referral rebate reversal audit row (controller/aff_rebate.go,
// action aff_rebate.reverse) renders in the viewer's language.
import { createInstance } from 'i18next'
import { describe, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { renderAuditContent } from '../format'

// Mirrors the options of src/i18n/config.ts that affect rendering.
async function createI18n(lng: 'en' | 'zh') {
  const i18n = createInstance()
  await i18n.init({
    lng,
    resources: { en, zh },
    nsSeparator: false,
    interpolation: { escapeValue: false },
  })
  return i18n
}

const params = {
  rebate_id: 17,
  trade_no: 'trax46-ep1',
  quota: '＄0.400000',
  deducted: '＄0.000000',
  reverse_reason: 'refund <#42> & chargeback',
  username: 'trax46_inv_a',
  target_user_id: 1419,
}

describe('aff_rebate.reverse audit content', () => {
  test('renders the zh template', async () => {
    const i18n = await createI18n('zh')
    expect(
      renderAuditContent(
        { op: { action: 'aff_rebate.reverse', params } },
        i18n.t
      )
    ).toBe(
      '冲销用户 trax46_inv_a 的邀请返利 #17（订单号 trax46-ep1，返利 ＄0.400000，扣回 ＄0.000000，原因：refund <#42> & chargeback）'
    )
  })

  test('renders the en template', async () => {
    const i18n = await createI18n('en')
    expect(
      renderAuditContent(
        {
          op: {
            action: 'aff_rebate.reverse',
            params: { ...params, deducted: '＄0.400000', reverse_reason: '-' },
          },
        },
        i18n.t
      )
    ).toBe(
      'Reversed referral rebate #17 of user trax46_inv_a (order trax46-ep1, rebate ＄0.400000, deducted ＄0.400000, reason: -)'
    )
  })
})
