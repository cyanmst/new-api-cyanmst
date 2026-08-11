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
// [TRAXNODE] 页头状态聚合徽章（design §3.3b：冻结中/已入账/已冲销/累计返利四枚，全库口径）。
// stats 为 null（空表，批次 C 备案）时按全零渲染，不报错。
import {
  CircleCheck,
  Clock,
  TrendingUp,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { formatQuota } from '@/lib/format'

import { AFF_REBATE_STATUS, type AffRebateStatusStat } from '../types'

interface StatTileProps {
  tone: IconBadgeTone
  icon: LucideIcon
  label: string
  quota: number
  count: number
}

function StatTile({ tone, icon: Icon, label, quota, count }: StatTileProps) {
  const { t } = useTranslation()

  return (
    <div className='bg-card flex items-center gap-3 rounded-xl border p-3 shadow-xs'>
      <IconBadge tone={tone} size='md'>
        <Icon />
      </IconBadge>
      <div className='min-w-0'>
        <p className='text-muted-foreground text-[11px] font-semibold'>
          {label}
        </p>
        <p className='text-[15px] font-bold tracking-tight tabular-nums'>
          {formatQuota(quota)}
        </p>
        <p className='text-muted-foreground text-[11px] tabular-nums'>
          {t('{{count}} records', { count })}
        </p>
      </div>
    </div>
  )
}

export function AffRebateStatsRow({
  stats,
}: {
  stats: AffRebateStatusStat[] | null | undefined
}) {
  const { t } = useTranslation()

  const byStatus = new Map<number, AffRebateStatusStat>()
  for (const stat of stats ?? []) {
    byStatus.set(stat.status, stat)
  }
  const frozen = byStatus.get(AFF_REBATE_STATUS.FROZEN)
  const credited = byStatus.get(AFF_REBATE_STATUS.CREDITED)
  const reversed = byStatus.get(AFF_REBATE_STATUS.REVERSED)
  const totalQuota = (stats ?? []).reduce((sum, stat) => sum + stat.quota, 0)
  const totalCount = (stats ?? []).reduce((sum, stat) => sum + stat.count, 0)

  return (
    <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
      <StatTile
        tone='warning'
        icon={Clock}
        label={t('Frozen')}
        quota={frozen?.quota ?? 0}
        count={frozen?.count ?? 0}
      />
      <StatTile
        tone='success'
        icon={CircleCheck}
        label={t('Credited')}
        quota={credited?.quota ?? 0}
        count={credited?.count ?? 0}
      />
      <StatTile
        tone='destructive'
        icon={Undo2}
        label={t('Reversed')}
        quota={reversed?.quota ?? 0}
        count={reversed?.count ?? 0}
      />
      <StatTile
        tone='info'
        icon={TrendingUp}
        label={t('Total Rebates')}
        quota={totalQuota}
        count={totalCount}
      />
    </div>
  )
}
