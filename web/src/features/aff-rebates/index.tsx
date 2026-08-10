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
// [TRAXNODE] 管理员返利管理页（design §3.3b / implement 2.3b）：
// 页头状态聚合徽章 → 筛选条 → 全量明文明细表 → 逐条冲销（二次确认弹窗）。
// 视觉基准 = 阶段 D 定稿样例 research/ui-sample/admin-rebates-page.html v1.1；
// 与用户侧 features/invitation 零共享组件（明文/脱敏物理隔离）。
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'

import { AffRebatesTable } from './components/rebates-admin-table'

export function AffRebates() {
  const { t } = useTranslation()

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Rebate Management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex w-full flex-col gap-4'>
          <p className='text-muted-foreground -mt-1 text-[13px]'>
            {t(
              'Audit the full rebate ledger and handle reversals (usernames shown in plaintext)'
            )}
          </p>
          <AffRebatesTable />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
