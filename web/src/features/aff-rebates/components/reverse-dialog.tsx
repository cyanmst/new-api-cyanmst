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
// [TRAXNODE] 冲销二次确认弹窗（design §3.3b，交互照样例 v1.1）：按记录状态区分后果文案——
// 冻结中=作废零追讨（warning 色调）；已入账=双扣允许负数（destructive 色调）；
// 冲销原因选填，存后端 reverse_reason 审计列并落 RecordLog。
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatQuota } from '@/lib/format'

import { AFF_REBATE_STATUS, type AffRebateAdminItem } from '../types'

interface ReverseRebateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: AffRebateAdminItem | null
  onConfirm: (item: AffRebateAdminItem, reason: string) => void
  reversing: boolean
}

export function ReverseRebateDialog({
  open,
  onOpenChange,
  item,
  onConfirm,
  reversing,
}: ReverseRebateDialogProps) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const frozen = item?.status === AFF_REBATE_STATUS.FROZEN
  const amount = formatQuota(item?.rebate_quota ?? 0)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('Reverse this rebate?')}</AlertDialogTitle>
        </AlertDialogHeader>

        <div className='grid grid-cols-[88px_1fr] gap-x-2.5 gap-y-1 text-[13px]'>
          <span className='text-muted-foreground'>{t('Trade No')}</span>
          <span className='font-mono text-xs break-all'>
            {item?.trade_no ?? '-'}
          </span>
          <span className='text-muted-foreground'>{t('Inviter')}</span>
          <span className='font-medium'>{item?.inviter_username ?? '-'}</span>
          <span className='text-muted-foreground'>{t('Rebate Amount')}</span>
          <span className='font-semibold tabular-nums'>{amount}</span>
        </div>

        {frozen ? (
          <div className='border-warning/25 bg-warning/10 rounded-lg border px-3.5 py-3 text-[12.5px] leading-relaxed'>
            {t(
              "This rebate has not been credited yet (frozen). Reversing voids it directly — nothing is clawed back and the inviter's balance is unaffected."
            )}
          </div>
        ) : (
          <div className='border-destructive/25 bg-destructive/10 rounded-lg border px-3.5 py-3 text-[12.5px] leading-relaxed'>
            {t(
              "This rebate has been credited. Reversing will deduct {{amount}} from the inviter's rebate balance (total earnings are deducted as well); if the balance is insufficient it will go negative and be offset by future rebates.",
              { amount }
            )}
          </div>
        )}

        <div className='space-y-1.5'>
          <Label htmlFor='aff-reverse-reason'>
            {t('Reversal reason (recorded in the audit log)')}
          </Label>
          <Textarea
            id='aff-reverse-reason'
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('e.g. order refunded / anti-fraud action')}
            className='min-h-16'
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={reversing}>
            {t('Cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant='destructive'
            disabled={reversing || !item}
            onClick={() => {
              if (item) onConfirm(item, reason.trim())
            }}
          >
            {reversing ? t('Reversing...') : t('Confirm Reverse')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
