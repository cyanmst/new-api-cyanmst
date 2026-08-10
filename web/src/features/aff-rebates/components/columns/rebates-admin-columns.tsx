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
// [TRAXNODE] 管理员返利明细列定义（明文用户名 + 审计三列回显 + 行尾冲销按钮，照样例 v1.1）：
// 冻结中行附解冻日期；已冲销行隐藏按钮、行内显示 冲销时间 · 操作人 · 原因。
import type { ColumnDef } from '@tanstack/react-table'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  formatCurrencyUSD,
  formatQuota,
  formatTimestampToDate,
} from '@/lib/format'

import { AFF_REBATE_STATUS, type AffRebateAdminItem } from '../../types'

// 明文用户名 + #id 双行单元格（非组件形式，规避 react-refresh only-export-components）
function renderUserCell(name: string, id: number) {
  return (
    <div className='flex flex-col'>
      <span className='font-medium'>{name || '-'}</span>
      <span className='text-muted-foreground text-[11px] tabular-nums'>
        #{id}
      </span>
    </div>
  )
}

export function useAffRebatesAdminColumns({
  onReverse,
}: {
  onReverse: (item: AffRebateAdminItem) => void
}): ColumnDef<AffRebateAdminItem>[] {
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
      size: 170,
    },
    {
      accessorKey: 'trade_no',
      header: t('Trade No'),
      cell: ({ row }) => (
        <span className='text-muted-foreground font-mono text-xs break-all'>
          {row.getValue('trade_no')}
        </span>
      ),
      size: 190,
    },
    {
      id: 'inviter',
      header: t('Inviter'),
      meta: { mobileTitle: true },
      cell: ({ row }) =>
        renderUserCell(row.original.inviter_username, row.original.inviter_id),
      size: 130,
    },
    {
      id: 'invitee',
      header: t('Invitee (payer)'),
      cell: ({ row }) =>
        renderUserCell(row.original.invitee_username, row.original.invitee_id),
      size: 130,
    },
    {
      accessorKey: 'money',
      header: t('Paid Amount'),
      cell: ({ row }) => (
        <span className='font-semibold tabular-nums'>
          {formatCurrencyUSD(row.getValue('money') as number)}
        </span>
      ),
      size: 100,
    },
    {
      accessorKey: 'rebate_quota',
      header: t('Rebate'),
      cell: ({ row }) => (
        <span className='font-semibold tabular-nums'>
          {formatQuota(row.getValue('rebate_quota') as number)}
        </span>
      ),
      size: 100,
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
          // 审计三列回显：冲销时间 · 操作人 · 原因（reverse_reason 可空）
          const parts = [
            item.reverse_time > 0
              ? dayjs(item.reverse_time * 1000).format('MM-DD')
              : null,
            item.reverse_by_username ||
              (item.reverse_by ? `#${item.reverse_by}` : null),
            item.reverse_reason || null,
          ].filter(Boolean)
          return (
            <div>
              <StatusBadge
                label={t('Reversed')}
                variant='danger'
                copyable={false}
                className='-ml-1.5'
              />
              {parts.length > 0 && (
                <div className='text-muted-foreground mt-0.5 max-w-[220px] text-[11px] break-words'>
                  {parts.join(' · ')}
                </div>
              )}
            </div>
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
      size: 150,
    },
    {
      id: 'actions',
      header: () => <span className='block text-right'>{t('Actions')}</span>,
      cell: ({ row }) => {
        const item = row.original
        const reversible =
          item.status === AFF_REBATE_STATUS.FROZEN ||
          item.status === AFF_REBATE_STATUS.CREDITED
        return (
          <div className='text-right'>
            {reversible ? (
              <Button
                variant='destructive'
                size='sm'
                className='h-7 px-2.5 text-xs'
                onClick={() => onReverse(item)}
              >
                {t('Reverse')}
              </Button>
            ) : (
              <span className='text-muted-foreground text-xs'>—</span>
            )}
          </div>
        )
      },
      size: 90,
    },
  ]
}
