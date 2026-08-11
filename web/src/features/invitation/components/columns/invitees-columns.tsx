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
// [TRAXNODE] 「邀请的用户」列定义（用户名列直渲染后端脱敏值；累计贡献口径=仅 status=2 已入账，见 design §2.7）
import type { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { formatQuota, formatTimestampToDate } from '@/lib/format'

import type { AffInviteeItem } from '../../types'

export function useInviteesColumns(): ColumnDef<AffInviteeItem>[] {
  const { t } = useTranslation()

  return [
    {
      accessorKey: 'username',
      header: t('Username'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <span className='font-medium'>{row.getValue('username')}</span>
      ),
      size: 180,
    },
    {
      accessorKey: 'created_at',
      header: t('Registered At'),
      cell: ({ row }) => (
        <span className='text-muted-foreground text-[13px] tabular-nums'>
          {formatTimestampToDate(row.getValue('created_at') as number)}
        </span>
      ),
      size: 175,
    },
    {
      accessorKey: 'contributed_quota',
      header: t('Contributed Rebates'),
      cell: ({ row }) => (
        <span className='font-semibold tabular-nums'>
          {formatQuota(row.getValue('contributed_quota') as number)}
        </span>
      ),
      size: 140,
    },
  ]
}
