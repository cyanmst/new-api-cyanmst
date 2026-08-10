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
// [TRAXNODE] 自建四统计卡（design §3.2 拍板：可划转/冻结中/总收益/邀请人数 + 邀请链接 + 划转按钮）。
// 信息架构借鉴（冻结位升格第一梯队统计），UI 按 rc.24 新栈设计语言实现；
// 上游 AffiliateRewardsCard 已随挪卡沦为死代码（文件保留，见 wallet/index.tsx 注释）。
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { SelfUserData } from '../types'

interface RebateStatsCardProps {
  user: SelfUserData | null
  /** SUM of frozen (status=1) rebates, in quota units */
  frozenTotal: number
  /** Unix seconds of the earliest frozen unlock; null when unknown */
  earliestUnlockTime: number | null
  affiliateLink: string
  onTransfer: () => void
  complianceConfirmed?: boolean
  loading?: boolean
}

export function RebateStatsCard({
  user,
  frozenTotal,
  earliestUnlockTime,
  affiliateLink,
  onTransfer,
  complianceConfirmed = true,
  loading,
}: RebateStatsCardProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <Card data-card-hover='false' className='overflow-hidden py-0'>
        <CardContent className='flex flex-col gap-4 p-4 sm:p-5'>
          <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
            {['transferable', 'frozen', 'total', 'invites'].map((key) => (
              <Skeleton key={key} className='h-24 rounded-xl' />
            ))}
          </div>
          <Skeleton className='h-9 rounded-lg' />
        </CardContent>
      </Card>
    )
  }

  const frozenSub =
    frozenTotal > 0 && earliestUnlockTime
      ? t('Earliest unlock on {{date}}', {
          date: dayjs(earliestUnlockTime * 1000).format('MM-DD'),
        })
      : t('Credited automatically after the freeze period')

  const stats: Array<{
    key: string
    label: string
    value: string
    sub: string
    dotClass: string
    valueClass?: string
  }> = [
    {
      key: 'transferable',
      label: t('Transferable'),
      value: formatQuota(user?.aff_quota ?? 0),
      sub: t('Transfer to your wallet balance anytime'),
      dotClass: 'bg-chart-5',
    },
    {
      key: 'frozen',
      label: t('Frozen'),
      value: formatQuota(frozenTotal),
      sub: frozenSub,
      dotClass: 'bg-warning',
      valueClass: 'text-warning',
    },
    {
      key: 'total',
      label: t('Total Earned'),
      value: formatQuota(user?.aff_history_quota ?? 0),
      sub: t('Historical credited rebates'),
      dotClass: 'bg-chart-1',
    },
    {
      key: 'invites',
      label: t('Invites'),
      value: String(user?.aff_count ?? 0),
      sub: t('Registered invited friends'),
      dotClass: 'bg-chart-3',
    },
  ]

  return (
    <Card data-card-hover='false' className='overflow-hidden py-0'>
      <div className='from-chart-3 via-chart-1/70 h-[3px] w-full bg-gradient-to-r to-transparent' />
      <CardContent className='flex flex-col gap-4 p-4 sm:p-5'>
        <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
          {stats.map((stat) => (
            <div
              key={stat.key}
              className='bg-muted/40 rounded-xl border p-3.5 sm:p-4'
            >
              <div className='text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase'>
                <span
                  className={cn('size-1.5 rounded-full', stat.dotClass)}
                  aria-hidden='true'
                />
                {stat.label}
              </div>
              <div
                className={cn(
                  'mt-1.5 text-xl font-bold tabular-nums sm:text-2xl',
                  stat.valueClass
                )}
              >
                {stat.value}
              </div>
              <p className='text-muted-foreground mt-0.5 truncate text-[11px]'>
                {stat.sub}
              </p>
            </div>
          ))}
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <Input
            value={affiliateLink}
            readOnly
            className='border-muted bg-background/70 h-9 min-w-[220px] flex-1 font-mono text-xs'
          />
          <CopyButton
            value={affiliateLink}
            variant='outline'
            className='bg-background size-9 shrink-0'
            iconClassName='size-4'
            tooltip={t('Copy referral link')}
            aria-label={t('Copy referral link')}
          />
          <Button
            onClick={onTransfer}
            disabled={!complianceConfirmed || (user?.aff_quota ?? 0) <= 0}
            className='h-9 shrink-0 px-3'
            size='sm'
          >
            {t('Transfer to Balance')}
          </Button>
        </div>
        {!complianceConfirmed ? (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Referral reward transfer is disabled until the administrator confirms compliance terms.'
            )}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
