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
// [TRAXNODE] 返利明细 Tab（照 redemption-codes/usage-logs 的 useDataTable + DataTablePage 模式；服务端分页）
import { useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'

import { getAffRebates } from '../api'
import { useRebatesColumns } from './columns/rebates-columns'

export function RebatesTable() {
  const { t } = useTranslation()
  const columns = useRebatesColumns()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['aff-rebates', pagination.pageIndex + 1, pagination.pageSize],
    queryFn: async () => {
      const res = await getAffRebates({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      })
      if (!res.success) {
        toast.error(res.message || t('Failed to load rebate records'))
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
      emptyTitle={t('No rebate records yet')}
      emptyDescription={t(
        'Rebates will appear here when your invited friends top up'
      )}
      skeletonKeyPrefix='aff-rebates-skeleton'
      toolbarProps={null}
      applyHeaderSize
      fixedHeight={false}
      paginationInFooter={false}
    />
  )
}
