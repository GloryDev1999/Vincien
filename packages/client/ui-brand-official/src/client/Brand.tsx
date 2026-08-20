import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official bear mark.
 */
export function OfficialBrandMark({ size = 24, className }: OfficialBrandMarkProps) {
  return <img src="/bear.png" alt="Vincien" width={size} height={size} className={className} style={{ objectFit: 'contain' }} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return (
    <span style={{ fontWeight: 'bold', fontSize: '1.25rem', letterSpacing: '0.05em' }}>
      Vincien
    </span>
  )
}
