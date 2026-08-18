/**
 * dsh-okf-knowledge browser half: registers the Knowledge entry in the sidebar
 * footer, which opens the knowledge browser/editor panel.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the sidebar SlotMap merge so 'sidebar.footer.action' resolves.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createKnowledgePanel } from './KnowledgePanel.js'
import { en, NS, zh } from './locales.js'

export const name = 'okf-knowledge-client'
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh))
  ctx.effect(() => ctx.locale.register(NS, 'en', en))
  const t = ctx.locale.bind(NS)
  const KnowledgePanel = createKnowledgePanel(t)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'okf-knowledge-base',
    order: 40,
    label: () => t('entry.label'),
  }, KnowledgePanel))
}
