import { type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

// 不再强制跳转到 /onboarding，允许未配置模型时直接进入主界面
// 用户可通过左侧"模型配置"入口随时配置或访问 /onboarding 进行向导式配置
export default function OnboardingGuard({ children }: Props) {
  return <>{children}</>
}
