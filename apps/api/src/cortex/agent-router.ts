import { Injectable } from '@nestjs/common';
import type { AgentInfo } from '@cowork/shared';
import { LlmService } from '../llm/llm.service';
import type { SfCredential } from '../snowflake/snowflake.client';

/** Picks the best agent for a question when the user chose "Auto" (AI_CLASSIFY over agent names). */
@Injectable()
export class AgentRouter {
  constructor(private readonly llm: LlmService) {}

  async pick(question: string, agents: AgentInfo[], cred?: SfCredential): Promise<AgentInfo | undefined> {
    const list = agents.filter((a) => a.kind === 'agent');
    if (list.length <= 1) return list[0];
    const labels = list.map((a) => a.displayName);
    const guide = list.map((a) => `${a.displayName}: ${a.description ?? 'no description'}`).join('; ');
    const label = await this.llm.classify(question, labels, `Choose the assistant best suited to answer. ${guide}`, cred);
    if (label) return list.find((a) => a.displayName === label);
    // Offline fallback: most word overlap with name, description and sample questions.
    const words = new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
    const score = (a: AgentInfo) =>
      [a.displayName, a.description ?? '', ...a.sampleQuestions].join(' ').toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((w) => words.has(w)).length ?? 0;
    return [...list].sort((a, b) => score(b) - score(a))[0];
  }
}
