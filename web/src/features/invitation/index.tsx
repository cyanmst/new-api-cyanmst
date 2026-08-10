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
// [TRAXNODE] 独立邀请页（design §3 / implement 2.2）：邀请归属条 → 自建四统计卡 → 规则文案区 → 双 Tab 明细。
// 视觉基准 = 阶段 D 定稿样例 research/ui-sample/invitation-page.html v1.5；
// 归属条判断走 getSelf.inviter_id != 0（上游原生下发，批次 B 偏差备案①）；
// 比例/冻结天数/分组白名单三值自 /api/status 动态插值，严禁写死（第六轮拍板）。
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { transferAffiliateQuota } from '@/features/wallet/api'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { useAffiliate, useTopupInfo } from '@/features/wallet/hooks'
import { useStatus } from '@/hooks/use-status'
import { getSelf } from '@/lib/api'
import { formatQuota } from '@/lib/format'

import { getAffRebates } from './api'
import { InvitedStrip } from './components/invited-strip'
import { InviteesTable } from './components/invitees-table'
import { RebateStatsCard } from './components/rebate-stats-card'
import { RebatesTable } from './components/rebates-table'
import { RebateRulesCard } from './components/rules-card'
import { AFF_REBATE_STATUS, type SelfUserData } from './types'

type DetailTab = 'rebates' | 'invitees'

export function Invitation() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [user, setUser] = useState<SelfUserData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [activeTab, setActiveTab] = useState<DetailTab>('rebates')

  const { status } = useStatus()
  const { topupInfo } = useTopupInfo()
  const { affiliateLink, loading: affiliateLoading } = useAffiliate()

  // [TRAXNODE] /api/status 三字段（controller/misc.go GetStatus 追加，非敏感展示值）
  const rebatePercent = Number(status?.aff_rebate_percentage ?? 0)
  const freezeDays = Number(status?.aff_rebate_freeze_days ?? 0)
  const groupWhitelist = String(status?.aff_rebate_group_whitelist ?? 'default')

  // Fetch and refresh user data (same wiring as the wallet page)
  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as SelfUserData)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    } finally {
      setUserLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  // Frozen summary: frozen_total is an all-records aggregate returned by the
  // rebates API; fetched independently from the paginated tab query so the
  // stats card does not follow table pagination. The earliest unlock date is
  // best-effort, derived from the newest 100 records (frozen records cluster
  // at the top of the id-desc list).
  const { data: rebatesSummary } = useQuery({
    queryKey: ['aff-rebates-summary'],
    queryFn: async () => {
      const res = await getAffRebates({ p: 1, page_size: 100 })
      if (!res.success || !res.data) return null
      return res.data
    },
  })

  const frozenTotal = rebatesSummary?.frozen_total ?? 0
  const earliestUnlockTime = useMemo(() => {
    const frozenItems = (rebatesSummary?.items ?? []).filter(
      (item) => item.status === AFF_REBATE_STATUS.FROZEN && item.unlock_time > 0
    )
    if (frozenItems.length === 0) return null
    return Math.min(...frozenItems.map((item) => item.unlock_time))
  }, [rebatesSummary])

  // [TRAXNODE] 划转反馈闭环（implement 2.2c）：成功 toast 明示划转金额与最新余额
  // （getSelf 响应本就含 quota，零新接口）+ 四统计即时刷新（fetchUser 更新
  // aff_quota/aff_count 等）+ 「前往钱包」action。不复用 useAffiliate.transferQuota
  // （其内置通用成功 toast，会与本页定制 toast 重复），直接调 wallet API。
  const handleTransfer = useCallback(
    async (quota: number): Promise<boolean> => {
      try {
        setTransferring(true)
        const response = await transferAffiliateQuota({ quota })
        if (!response.success) {
          toast.error(response.message || t('Transfer failed'))
          return false
        }
        let latestBalance: number | null = null
        try {
          const self = await getSelf()
          if (self.success && self.data) {
            setUser(self.data as SelfUserData)
            latestBalance = (self.data as SelfUserData).quota
          }
        } catch {
          // Balance display is best-effort; the transfer itself succeeded.
        }
        toast.success(t('Transfer successful'), {
          description:
            latestBalance != null
              ? t(
                  'Transferred {{amount}} to balance, current balance {{balance}}',
                  {
                    amount: formatQuota(quota),
                    balance: formatQuota(latestBalance),
                  }
                )
              : t('Transferred {{amount}} to balance', {
                  amount: formatQuota(quota),
                }),
          action: {
            label: t('Go to Wallet'),
            onClick: () => {
              void navigate({ to: '/wallet' })
            },
          },
        })
        return true
      } catch {
        toast.error(t('Transfer failed'))
        return false
      } finally {
        setTransferring(false)
      }
    },
    [navigate, t]
  )

  const handleTabChange = useCallback((value: string) => {
    if (value === 'rebates' || value === 'invitees') {
      setActiveTab(value)
    }
  }, [])

  // [TRAXNODE] 归属条：invited=false（inviter_id==0）整条不渲染（design §3.1）
  const invited = (user?.inviter_id ?? 0) !== 0

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Referral Program')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
            <p className='text-muted-foreground -mt-1 text-[13px]'>
              {t(
                'Invite friends to sign up and earn a {{percent}}% rebate on every top-up they make',
                { percent: rebatePercent }
              )}
            </p>

            {invited && <InvitedStrip rebatePercent={rebatePercent} />}

            <RebateStatsCard
              user={user}
              frozenTotal={frozenTotal}
              earliestUnlockTime={earliestUnlockTime}
              affiliateLink={affiliateLink}
              onTransfer={() => setTransferDialogOpen(true)}
              complianceConfirmed={
                topupInfo?.payment_compliance_confirmed !== false
              }
              loading={userLoading || affiliateLoading}
            />

            <RebateRulesCard
              rebatePercent={rebatePercent}
              freezeDays={freezeDays}
              groupWhitelist={groupWhitelist}
            />

            <div className='flex flex-col gap-3'>
              <Tabs value={activeTab} onValueChange={handleTabChange}>
                <TabsList>
                  <TabsTrigger value='rebates'>
                    {t('Rebate Details')}
                    <span className='bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums'>
                      {rebatesSummary?.total ?? 0}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value='invitees'>
                    {t('Invited Users')}
                    <span className='bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums'>
                      {user?.aff_count ?? 0}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {activeTab === 'rebates' ? <RebatesTable /> : <InviteesTable />}
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onConfirm={handleTransfer}
        availableQuota={user?.aff_quota ?? 0}
        transferring={transferring}
      />
    </>
  )
}
