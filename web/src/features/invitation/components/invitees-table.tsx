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
// [TRAXNODE] 「邀请的用户」Tab（同 rebates-table 模式；total 兼作邀请人数，与 aff_count 归真口径对照）
import { useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'

import { getAffInvitees } from '../api'
import { useInviteesColumns } from './columns/invitees-columns'

export function InviteesTable() {
  const { t } = useTranslation()
  const columns = useInviteesColumns()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['aff-invitees', pagination.pageIndex + 1, pagination.pageSize],
    queryFn: async () => {
      const res = await getAffInvitees({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      })
      if (!res.success) {
        toast.error(res.message || t('Failed to load invited users'))
        return { items: [], total: 0 }
      }
      return {
        items: res.data?.items ?? [],
        total: res.data?.total ?? 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    pagination,
    onPaginationChange: setPagination,
    manualPagination: true,
    enableSorting: false,
    totalCount: data?.total ?? 0,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No invited users yet')}
      emptyDescription={t(
        'Invited friends will appear here after they sign up through your link'
      )}
      skeletonKeyPrefix='aff-invitees-skeleton'
      toolbarProps={null}
      applyHeaderSize
      fixedHeight={false}
      paginationInFooter={false}
    />
  )
}
