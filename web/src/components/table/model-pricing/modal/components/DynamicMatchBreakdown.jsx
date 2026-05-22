import React from 'react';
import { Avatar, Tag, Typography } from '@douyinfe/semi-ui';
import { IconPriceTag } from '@douyinfe/semi-icons';
import { getCurrencyConfig } from '../../../../../helpers';

const { Text } = Typography;

export default function DynamicMatchBreakdown({ dynamicMatchConfig, t }) {
  const { symbol, rate } = getCurrencyConfig();

  let cfg;
  try {
    cfg = typeof dynamicMatchConfig === 'string'
      ? JSON.parse(dynamicMatchConfig)
      : dynamicMatchConfig;
  } catch {
    return null;
  }
  if (!cfg || !Array.isArray(cfg.rules) || cfg.rules.length === 0) {
    return null;
  }

  return (
    <div>
      <div className='flex items-center mb-4'>
        <Avatar size='small' color='cyan' className='mr-2 shadow-md'>
          <IconPriceTag size={16} />
        </Avatar>
        <div>
          <Text className='text-lg font-medium'>{t('动态计费')}</Text>
          <div className='text-xs text-gray-600'>
            {t('价格根据请求参数动态匹配')}
            {cfg.multiplier_field && (
              <span>
                {' — '}
                {t('倍率字段')}: <code>{cfg.multiplier_field}</code>
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        {cfg.rules.map((rule, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 12px',
              borderRadius: 6,
              background: 'var(--semi-color-fill-0)',
              marginBottom: 4,
              borderLeft: '3px solid var(--semi-color-primary)',
            }}
          >
            <div>
              <Tag color='blue' size='small' style={{ marginRight: 8 }}>
                {rule.label || `#${i + 1}`}
              </Tag>
              <Text size='small' style={{ color: 'var(--semi-color-text-2)' }}>
                {rule.field_path}{' '}
                <code style={{ fontSize: 11 }}>{rule.operator}</code>{' '}
                {rule.value}
              </Text>
            </div>
            <Tag color='green' size='small'>
              {symbol}{(rule.price_per_unit * rate).toFixed(4)}
              {cfg.multiplier_field ? `/${t('单位')}` : `/${t('次')}`}
            </Tag>
          </div>
        ))}
      </div>

      {cfg.default_price > 0 && (
        <div
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            background: 'var(--semi-color-warning-light-default)',
          }}
        >
          <Text size='small'>
            {t('默认价格')}: {symbol}{(cfg.default_price * rate).toFixed(4)}
            {cfg.multiplier_field ? `/${t('单位')}` : `/${t('次')}`}
          </Text>
        </div>
      )}
    </div>
  );
}
