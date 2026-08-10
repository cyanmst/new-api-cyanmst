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
// [TRAXNODE] 管理员返利明细表（照 redemption-codes 的 useTableUrlState + DataTablePage 模式）：
// 筛选=关键词搜用户名(globalFilter) + 状态下拉(columnFilters) + 订单号精确(additionalSearch，本地态)；
// stats 聚合随列表响应返回（全库口径），空表时后端返回 null 已容错（批次 C 备案）。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Input } from '@/components/ui/input'
import { useDebounce } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { formatQuota } from '@/lib/format'

import { getAffRebateLogs, reverseAffRebate } from '../api'
import { AFF_REBATE_STATUS, type AffRebateAdminItem } from '../types'
import { useAffRebatesAdminColumns } from './columns/rebates-admin-columns'
import { ReverseRebateDialog } from './reverse-dialog'
import { AffRebateStatsRow } from './stats-row'

const route = getRouteApi('/_authenticated/aff-rebates/')

export function AffRebatesTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [reverseTarget, setReverseTarget] = useState<AffRebateAdminItem | null>(
    null
  )
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false)
  const [reversing, setReversing] = useState(false)
  const [tradeNoInput, setTradeNoInput] = useState('')
  const tradeNo = useDebounce(tradeNoInput.trim(), 500)

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })
  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) ?? []
  const statusFilterValue = statusFilter[0] ?? ''

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'aff-rebate-admin',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      statusFilterValue,
      tradeNo,
    ],
    queryFn: async () => {
      const res = await getAffRebateLogs({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        keyword: globalFilter?.trim() || undefined,
        status: statusFilterValue || undefined,
        trade_no: tradeNo || undefined,
      })
      if (!res.success) {
        toast.error(res.message || t('Failed to load rebate records'))
        return { items: [], total: 0, stats: null }
      }
      return {
        items: res.data?.items ?? [],
        total: res.data?.total ?? 0,
        stats: res.data?.stats ?? null,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const openReverseDialog = (item: AffRebateAdminItem) => {
    setReverseTarget(item)
    setReverseDialogOpen(true)
  }

  const columns = useAffRebatesAdminColumns({ onReverse: openReverseDialog })

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    columnFilters,
    globalFilter,
    pagination,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    enableSorting: false,
    totalCount: data?.total ?? 0,
    ensurePageInRange,
  })

  // 冲销执行：成功后按原状态区分 toast 文案（样例 v1.1）；already_reversed=幂等提示；
  // 完成后整表 + 聚合刷新（同一 queryKey）。
  const handleReverse = async (item: AffRebateAdminItem, reason: string) => {
    setReversing(true)
    try {
      const res = await reverseAffRebate(item.id, reason)
      if (!res.success) {
        toast.error(res.message || t('Reversal failed'))
        return
      }
      if (res.data?.already_reversed) {
        toast.info(t('This rebate has already been reversed'))
      } else if (item.status === AFF_REBATE_STATUS.CREDITED) {
        toast.success(t('Reversal completed'), {
          description: t(
            "Deducted {{amount}} from {{inviter}}'s rebate balance (total earnings deducted as well)",
            {
              amount: formatQuota(item.rebate_quota),
              inviter: item.inviter_username,
            }
          ),
        })
      } else {
        toast.success(t('Reversal completed'), {
          description: t(
            'Frozen rebate {{amount}} for order {{tradeNo}} has been voided (nothing to claw back)',
            {
              amount: formatQuota(item.rebate_quota),
              tradeNo: item.trade_no,
            }
          ),
        })
      }
      setReverseDialogOpen(false)
      setReverseTarget(null)
      await queryClient.invalidateQueries({ queryKey: ['aff-rebate-admin'] })
    } finally {
      setReversing(false)
    }
  }

  return (
    <>
      <AffRebateStatsRow stats={data?.stats} />

      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No rebate records found')}
        emptyDescription={t(
          'Rebate records will appear here once invited users top up'
        )}
        skeletonKeyPrefix='aff-rebate-admin-skeleton'
        applyHeaderSize
        fixedHeight={false}
        paginationInFooter={false}
        toolbarProps={{
          searchPlaceholder: t('Search by username (inviter / invitee)'),
          searchDebounceMs: 500,
          additionalSearch: (
            <Input
              placeholder={t('Exact trade number')}
              value={tradeNoInput}
              onChange={(event) => setTradeNoInput(event.target.value)}
              className='w-full sm:w-[180px]'
            />
          ),
          hasAdditionalFilters: tradeNoInput !== '',
          onReset: () => {
            setTradeNoInput('')
          },
          filters: [
            {
              columnId: 'status',
              title: t('Status'),
              options: [
                {
                  label: t('Frozen'),
                  value: String(AFF_REBATE_STATUS.FROZEN),
                },
                {
                  label: t('Credited'),
                  value: String(AFF_REBATE_STATUS.CREDITED),
                },
                {
                  label: t('Reversed'),
                  value: String(AFF_REBATE_STATUS.REVERSED),
                },
              ],
              singleSelect: true,
            },
          ],
        }}
      />

      <ReverseRebateDialog
        open={reverseDialogOpen}
        onOpenChange={(open) => {
          setReverseDialogOpen(open)
          if (!open) setReverseTarget(null)
        }}
        item={reverseTarget}
        onConfirm={handleReverse}
        reversing={reversing}
      />
    </>
  )
}
