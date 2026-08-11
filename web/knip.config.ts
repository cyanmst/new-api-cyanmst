import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  ignore: [
    'src/components/ui/**',
    'src/routeTree.gen.ts',
    // [TRAXNODE] 邀请卡挪至邀请页（features/invitation）后，上游组件保留为死代码
    // （避免上游合并冲突），在此豁免 knip 未使用告警
    'src/features/wallet/components/affiliate-rewards-card.tsx',
  ],
  ignoreDependencies: ['tailwindcss', 'tw-animate-css'],
}

export default config
