/** Bundled `okf-authoring` skill provider (R-010). */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'okf-authoring'
const SKILL_BODY_URL = new URL('../assets/okf-authoring.md', import.meta.url)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const DESCRIPTION = 'Create and maintain Open Knowledge Format (OKF) knowledge entries in the project knowledge base (.dsh/knowledge) or shared knowledge. Use when the user asks to build a knowledge base, capture project knowledge, turn documents or notes into knowledge entries, fill OKF frontmatter, keep sources and provenance, link concepts, or maintain the knowledge index and log.'

const CANDIDATE: SkillCandidate = {
  name: 'okf-authoring',
  description: DESCRIPTION,
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/** Register the bundled okf-authoring provider on `ctx.skills`. */
export function registerOkfSkill(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
