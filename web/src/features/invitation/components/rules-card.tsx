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
// [TRAXNODE] 返利规则文案区（design §3.1）：资格说明 + 冻结说明 + 知情披露（身份双向匿名）。
// 比例/冻结天数/分组白名单三值自 /api/status 的 aff_rebate_* 三字段动态插值（第六轮拍板），严禁写死。
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'

interface RebateRulesCardProps {
  rebatePercent: number
  freezeDays: number
  groupWhitelist: string
}

export function RebateRulesCard({
  rebatePercent,
  freezeDays,
  groupWhitelist,
}: RebateRulesCardProps) {
  const { t } = useTranslation()

  const rules = [
    t(
      'Friends who sign up through your referral link earn you a {{percent}}% rebate on every successful top-up they make',
      { percent: rebatePercent }
    ),
    freezeDays > 0
      ? t(
          'Rebates are frozen for {{days}} day(s), then automatically credited to your transferable balance and can be transferred to your wallet at any time',
          { days: freezeDays }
        )
      : t(
          'Rebates are credited to your transferable balance immediately and can be transferred to your wallet at any time'
        ),
    t(
      'Only inviters in the {{groups}} group(s) are eligible for rebates; subscription purchases do not generate rebates',
      { groups: groupWhitelist }
    ),
    t(
      'If a top-up order is refunded, the corresponding rebate will be reversed; rebate credits cannot be invoiced'
    ),
    t(
      'When your invited friends top up, their masked usernames and top-up records are shown in your details list'
    ),
  ]

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardContent className='p-4 sm:p-5'>
        <h3 className='flex items-center gap-2 text-sm font-semibold'>
          <Info className='text-muted-foreground size-4' />
          {t('Rebate Rules')}
        </h3>
        <ul className='mt-3 space-y-2'>
          {rules.map((rule, index) => (
            <li
              key={rule}
              className='text-muted-foreground flex items-start gap-2.5 text-[13px]'
            >
              <span className='bg-primary/10 text-primary mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md text-[11px] font-bold'>
                {index + 1}
              </span>
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
