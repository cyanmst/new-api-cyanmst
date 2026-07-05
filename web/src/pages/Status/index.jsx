/*
Copyright (C) 2025 QuantumNous

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

// [TRAXNODE] 分组监控公开页（独立新增，零上游侵入）
// 数据源：GET /api/uptime/status（New API 内置 Uptime Kuma 聚合接口，公开无需登录）
// 渲染：汇总栏 + 分组卡片（名称/状态/可用率/响应时间/心跳条）。
// heartbeats 与 ping 字段来自本项目对 controller/uptime_kuma.go 的 [TRAXNODE] 扩展，
// 后端为旧版本时自动降级为仅显示基础四字段（name/uptime/status/group）。

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Card, Empty, Spin, Tag, Tooltip } from '@douyinfe/semi-ui';
import {
  IllustrationConstruction,
  IllustrationConstructionDark,
} from '@douyinfe/semi-illustrations';
import { Activity, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers';
import { UPTIME_STATUS_MAP } from '../../constants/dashboard.constants';

// 自动刷新间隔（秒）
const REFRESH_INTERVAL = 60;

// Semi Tag 预设色映射（与 UPTIME_STATUS_MAP 状态对应）
const STATUS_TAG_COLOR = {
  1: 'green',
  0: 'red',
  2: 'amber',
  3: 'blue',
};

const GroupStatus = () => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const loadingRef = useRef(false);

  const loadData = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await API.get('/api/uptime/status');
      const { success, data } = res.data;
      if (success) {
        setGroups(data || []);
        setLastUpdated(new Date());
      }
    } catch (err) {
      // 公开页不弹错误提示，保留空态展示
      console.error(err);
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setCountdown(REFRESH_INTERVAL);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 倒计时 + 自动刷新
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          loadData();
          return REFRESH_INTERVAL;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loadData]);

  const monitors = useMemo(
    () => groups.flatMap((group) => group.monitors || []),
    [groups],
  );

  const summary = useMemo(() => {
    const up = monitors.filter((m) => m.status === 1).length;
    const down = monitors.filter((m) => m.status === 0).length;
    const avgUptime =
      monitors.length > 0
        ? monitors.reduce((sum, m) => sum + (m.uptime || 0), 0) /
          monitors.length
        : 0;
    return { up, down, avgUptime };
  }, [monitors]);

  const getStatusInfo = (status) =>
    UPTIME_STATUS_MAP[status] || { color: '#8b9aa7', label: '未知' };

  // 心跳条：一格一拍（时间升序，最右为最新），hover 显示时间/状态/响应时间
  const renderHeartbeatBar = (monitor) => {
    const heartbeats = monitor.heartbeats;
    // 后端旧版本无 heartbeats 字段时优雅降级，不渲染心跳条
    if (!Array.isArray(heartbeats) || heartbeats.length === 0) return null;
    return (
      <div className='flex items-center gap-[3px] mt-3'>
        {heartbeats.map((beat, beatIdx) => {
          const beatInfo = getStatusInfo(beat.status);
          const beatTime = (beat.time || '').split('.')[0];
          return (
            <Tooltip
              key={`${beatTime}-${beatIdx}`}
              content={
                <div className='text-xs'>
                  <div>{beatTime}</div>
                  <div>
                    {t(beatInfo.label)}
                    {typeof beat.ping === 'number' && beat.ping > 0
                      ? ` · ${beat.ping} ms`
                      : ''}
                  </div>
                </div>
              }
            >
              <div
                className='h-5 flex-1 max-w-[8px] rounded-full cursor-pointer transition-transform hover:scale-y-125'
                style={{ backgroundColor: beatInfo.color }}
              />
            </Tooltip>
          );
        })}
      </div>
    );
  };

  const renderMonitorCard = (monitor, idx) => {
    const statusInfo = getStatusInfo(monitor.status);
    return (
      <Card key={`${monitor.name}-${idx}`} className='!rounded-2xl shadow-sm'>
        <div className='flex items-center justify-between gap-2 mb-3'>
          <div className='flex items-center gap-2 min-w-0'>
            <div
              className='w-2.5 h-2.5 rounded-full flex-shrink-0'
              style={{ backgroundColor: statusInfo.color }}
            />
            <span className='text-sm font-medium text-semi-color-text-0 truncate'>
              {monitor.name}
            </span>
          </div>
          <Tag
            color={STATUS_TAG_COLOR[monitor.status] || 'grey'}
            size='small'
            shape='circle'
          >
            {t(statusInfo.label)}
          </Tag>
        </div>
        <div className='flex items-end justify-between gap-2'>
          <div
            className='text-3xl font-bold'
            style={{ color: statusInfo.color }}
          >
            {((monitor.uptime || 0) * 100).toFixed(2)}%
          </div>
          {typeof monitor.ping === 'number' && monitor.ping > 0 && (
            <span className='text-xs text-semi-color-text-2 mb-1'>
              {t('响应时间')}: {monitor.ping} ms
            </span>
          )}
        </div>
        {renderHeartbeatBar(monitor)}
      </Card>
    );
  };

  const renderSummary = () => (
    <Card className='!rounded-2xl shadow-sm mb-6'>
      <div className='grid grid-cols-3 divide-x divide-semi-color-border text-center'>
        <div>
          <div className='text-2xl font-bold text-semi-color-success'>
            {summary.up}
          </div>
          <div className='text-xs text-semi-color-text-2 mt-1'>{t('在线')}</div>
        </div>
        <div>
          <div
            className={`text-2xl font-bold ${
              summary.down > 0
                ? 'text-semi-color-danger'
                : 'text-semi-color-text-0'
            }`}
          >
            {summary.down}
          </div>
          <div className='text-xs text-semi-color-text-2 mt-1'>{t('离线')}</div>
        </div>
        <div>
          <div className='text-2xl font-bold text-semi-color-text-0'>
            {(summary.avgUptime * 100).toFixed(2)}%
          </div>
          <div className='text-xs text-semi-color-text-2 mt-1'>
            {t('平均可用率')}
          </div>
        </div>
      </div>
    </Card>
  );

  return (
    <div className='max-w-5xl mx-auto px-4 py-6 md:py-8'>
      {/* 标题栏 */}
      <div className='flex flex-wrap items-center justify-between gap-2 mb-6'>
        <div className='flex items-center gap-2'>
          <Activity size={22} className='text-semi-color-primary' />
          <h1 className='text-xl font-bold text-semi-color-text-0'>
            {t('分组监控')}
          </h1>
        </div>
        <div className='flex items-center gap-3'>
          <span className='text-xs text-semi-color-text-2'>
            {lastUpdated
              ? `${t('最后更新')}: ${lastUpdated.toLocaleTimeString()}`
              : ''}
          </span>
          <span className='text-xs text-semi-color-text-2'>
            {t('自动刷新')}: {countdown}s
          </span>
          <Button
            icon={<RefreshCw size={14} />}
            onClick={loadData}
            loading={loading}
            size='small'
            theme='borderless'
            type='tertiary'
            className='!rounded-full'
            aria-label={t('刷新')}
          />
        </div>
      </div>

      <Spin spinning={loading && monitors.length === 0}>
        {monitors.length > 0 ? (
          <>
            {renderSummary()}
            {groups.map((group, groupIdx) => (
              <div key={group.categoryName || groupIdx} className='mb-6'>
                <div className='flex items-center gap-2 mb-3'>
                  <span className='text-base font-semibold text-semi-color-text-0'>
                    {group.categoryName}
                  </span>
                  <Tag color='grey' size='small' shape='circle'>
                    {group.monitors ? group.monitors.length : 0}
                  </Tag>
                </div>
                <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'>
                  {(group.monitors || []).map(renderMonitorCard)}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className='flex justify-center items-center py-16'>
            <Empty
              image={
                <IllustrationConstruction style={{ width: 150, height: 150 }} />
              }
              darkModeImage={
                <IllustrationConstructionDark
                  style={{ width: 150, height: 150 }}
                />
              }
              title={t('暂无监控数据')}
              description={t('请联系管理员在系统设置中配置Uptime')}
            />
          </div>
        )}
      </Spin>
    </div>
  );
};

export default GroupStatus;
