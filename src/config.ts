/** Plugin configuration schema and resolution. */

import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import { DEFAULT_PROJECT_DIR } from './scope.js'

export interface Config {
  /** Project bundle directory relative to the project root. */
  projectDir?: string
  /** Absolute roots of shared OKF bundles usable from every project. */
  sharedRoots?: string[]
  /** Maximum okf_search results. */
  maxResults?: number
}

export const Config: z<Config> = z.object({
  projectDir: z.string().description('Project bundle directory relative to the project root (default: .dsh/knowledge)'),
  sharedRoots: z.array(z.string()).description('Absolute roots of shared knowledge bundles (default: <dsh home>/knowledge/shared)'),
  maxResults: z.natural().min(1).max(50).description('Maximum okf_search results (default: 8)'),
})

export interface ResolvedConfig {
  projectDir: string
  sharedRoots: string[]
  maxResults: number
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const sharedRoots = config.sharedRoots !== undefined && config.sharedRoots.length > 0
    ? config.sharedRoots
    : [join(resolveDshHome(), 'knowledge', 'shared')]
  return {
    projectDir: config.projectDir ?? DEFAULT_PROJECT_DIR,
    sharedRoots,
    maxResults: config.maxResults ?? 8,
  }
}
