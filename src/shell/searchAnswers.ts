/**
 * R3.2: the "Answers" rows of the Search dialog. PURE. Search matches a typed question to the fixed catalog (core/answers.ts `matchAnswers`) and offers the matching questions as
 * ordinary rows; choosing one opens the answer screen. The row always shows the reader's OWN question and period, never an echo of what was typed, so what Ledger will answer is
 * what the row says. Nothing is read here: matching uses only the readers' fixed phrases.
 */
import { ANSWERS_BASE, answerPath, type AnswerMatches, type AnswerReader } from '../core/answers';

export interface AnswerHit { key: string; title: string; subtitle?: string; caveat?: string; kind: string; to: string }
export interface AnswerHits { heading: string; items: AnswerHit[]; note: string | null }

const NONE: AnswerHits = { heading: '', items: [], note: null };

/** Is the text phrased as a question? Used only to decide whether to say that Ledger answers a fixed set of questions. */
export const looksLikeQuestion = (q: string): boolean => /\?\s*$/.test(q.trim()) || /^\s*(what|whats|what's|which|how|who|when|where|are|is|do|does|can|show|tell)\b/i.test(q);

export function answerHits(q: string, m: AnswerMatches, examples: readonly { reader: AnswerReader }[]): AnswerHits {
  if (q.trim() === '') {
    if (examples.length === 0) return NONE;
    return {
      heading: 'Questions you can ask', note: null,
      items: [
        ...examples.map(({ reader }): AnswerHit => ({ key: reader.id, title: reader.question, subtitle: reader.defaultPeriod, kind: 'Answer', to: answerPath(reader.id) })),
        { key: 'what-can-i-ask', title: 'What can I ask?', subtitle: 'See every question Ledger can answer', kind: 'Page', to: ANSWERS_BASE },
      ],
    };
  }
  if (m.ambiguous) {
    return { heading: 'Answers', note: `“${m.ambiguous.title}” could mean several things. ${m.ambiguous.note.replace(/^That could mean several things\.\s*/, '')}`, items: m.ambiguous.choices.map((c): AnswerHit => ({ key: c.reader.id, title: c.reader.question, subtitle: c.reader.defaultPeriod, kind: 'Answer', to: answerPath(c.reader.id) })) };
  }
  if (m.suggestions.length === 0) return NONE;
  return {
    heading: 'Answers', note: null,
    items: m.suggestions.map((s): AnswerHit => ({ key: s.reader.id, title: s.reader.question, subtitle: s.reader.defaultPeriod, ...(s.caveat ? { caveat: s.caveat } : {}), kind: 'Answer', to: answerPath(s.reader.id) })),
  };
}
