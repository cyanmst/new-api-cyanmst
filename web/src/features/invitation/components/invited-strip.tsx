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
// [TRAXNODE] 邀请归属条（被邀人视角知情披露，身份匿名——design §3.1 匿名拍板）：
// 不显示邀请人用户名；无邀请人（inviter_id == 0）时由父组件整条不渲染；比例与规则区同源插值。
import { UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'

interface InvitedStripProps {
  rebatePercent: number
}

export function InvitedStrip({ rebatePercent }: InvitedStripProps) {
  const { t } = useTranslation()

  return (
    <div className='border-info/25 bg-info/10 text-muted-foreground flex flex-wrap items-center gap-2.5 rounded-xl border px-4 py-2.5 text-[13px]'>
      <IconBadge tone='info' size='sm'>
        <UserPlus />
      </IconBadge>
      <span className='min-w-0 flex-1'>
        {t(
          "You signed up through a friend's referral link — each top-up you make earns your inviter a {{percent}}% rebate",
          { percent: rebatePercent }
        )}
      </span>
      <span className='text-xs whitespace-nowrap'>
        {t('This does not affect the amount you receive')}
      </span>
    </div>
  )
}
