/**
 * dsh-okf-knowledge: project knowledge bases for DeepSeek Harness in the Open
 * Knowledge Format (OKF v0.2).
 *
 * Host half. Registers:
 * - okf_search / okf_read / okf_validate tools scoped to
 *   the calling session's project bundle plus configured shared bundles,
 * - the bundled `okf-authoring` skill,
 * - the `/okf-knowledge/api` web routes (only when a web server is present).
 *
 * The browser half (`dsh-okf-knowledge/client`) adds the Knowledge entry to the
 * Web UI sidebar.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import { type Config, resolveConfig } from './config.js'
import { registerKnowledgeTools } from './tools.js'
import { registerOkfSkill } from './skill.js'
import * as webApi from './http.js'

export { Config } from './config.js'
export {
  validateConcept, splitFrontmatter, conceptTemplate, bundleIndexTemplate,
  trustTier, OKF_VERSION,
} from './okf.js'

export const name = 'okf-knowledge'
export const inject = ['tools', 'skills']

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  registerKnowledgeTools(ctx, resolved)
  registerOkfSkill(ctx)
  // The web API activates only where a webServer service exists (web
  // profiles); in headless profiles this nested plugin stays pending.
  ctx.plugin(webApi, resolved)
  ctx.logger.info('knowledge base ready (project dir: %s, shared roots: %s)', resolved.projectDir, resolved.sharedRoots.join(', '))
}
