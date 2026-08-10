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
// [TRAXNODE] 返利明细列定义（用户名列直渲染后端脱敏值；状态列三态 + 冻结行附解冻日期——implement 2.4b）
import type { ColumnDef } from '@tanstack/react-table'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  formatCurrencyUSD,
  formatQuota,
  formatTimestampToDate,
} from '@/lib/format'

import { AFF_REBATE_STATUS, type AffRebateItem } from '../../types'

export function useRebatesColumns(): ColumnDef<AffRebateItem>[] {
  const { t } = useTranslation()

  return [
    {
      accessorKey: 'create_time',
      header: t('Time'),
      cell: ({ row }) => (
        <span className='text-muted-foreground text-[13px] tabular-nums'>
          {formatTimestampToDate(row.getValue('create_time') as number)}
        </span>
      ),
      size: 175,
    },
    {
      accessorKey: 'invitee_username',
      header: t('Source User'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <span className='font-medium'>{row.getValue('invitee_username')}</span>
      ),
      size: 140,
    },
    {
      accessorKey: 'money',
      header: t('Paid Amount'),
      cell: ({ row }) => (
        <span className='font-semibold tabular-nums'>
          {formatCurrencyUSD(row.getValue('money') as number)}
        </span>
      ),
      size: 110,
    },
    {
      accessorKey: 'rebate_quota',
      header: t('Rebate'),
      cell: ({ row }) => (
        <span className='font-semibold tabular-nums'>
          {formatQuota(row.getValue('rebate_quota') as number)}
        </span>
      ),
      size: 110,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const item = row.original
        if (item.status === AFF_REBATE_STATUS.FROZEN) {
          return (
            <div>
              <StatusBadge
                label={t('Frozen')}
                variant='warning'
                copyable={false}
                className='-ml-1.5'
              />
              <div className='text-muted-foreground mt-0.5 text-[11px] tabular-nums'>
                {t('Unlocks on {{date}}', {
                  date: dayjs(item.unlock_time * 1000).format('MM-DD'),
                })}
              </div>
            </div>
          )
        }
        if (item.status === AFF_REBATE_STATUS.CREDITED) {
          return (
            <StatusBadge
              label={t('Credited')}
              variant='success'
              copyable={false}
              className='-ml-1.5'
            />
          )
        }
        if (item.status === AFF_REBATE_STATUS.REVERSED) {
          return (
            <StatusBadge
              label={t('Reversed')}
              variant='danger'
              copyable={false}
              className='-ml-1.5'
            />
          )
        }
        return (
          <StatusBadge
            label={String(item.status)}
            variant='neutral'
            copyable={false}
            className='-ml-1.5'
          />
        )
      },
      size: 130,
    },
  ]
}
