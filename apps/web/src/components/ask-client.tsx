'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AskMode, AskResponse } from '@gita/types';

import { cn } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

const MODES: Array<{ value: AskMode; label: string }> = [
  { value: 'simple', label: 'Explain simply' },
  { value: 'deep', label: 'Explain deeply' },
  { value: 'beginner', label: 'For a beginner' },
  { value: 'sources_only', label: 'Show source verses' },
  { value: 'compare_interpretations', label: 'Compare interpretations' },
];

const EXAMPLES = [
  'What does the Gita say about duty?',
  'How should I deal with fear of failure?',
  'What is karma yoga?',
  'gusse ko kaise control karein',
];

export function AskClient({
  initialQuestion = '',
  verseRef = null,
}: {
  initialQuestion?: string;
  verseRef?: string | null;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [mode, setMode] = useState<AskMode>('default');
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(text: string, nextMode: AskMode = mode) {
    const trimmed = text.trim();
    if (trimmed.length < 3) return;

    setStatus('loading');
    setError(null);
    try {
      const response = await fetch(`${API_URL}/v1/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, mode: nextMode, verseRef }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'That did not work. Please try again.');
      }
      setAnswer((await response.json()) as AskResponse);
      setStatus('idle');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
      setStatus('error');
    }
  }

  const isRefusal = answer?.groundingStatus === 'insufficient_evidence';

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(question);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <textarea
          id="ask-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter submits; Shift+Enter adds a line, as people expect.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit(question);
            }
          }}
          rows={3}
          maxLength={1000}
          placeholder={
            verseRef
              ? `Ask about verse ${verseRef}…`
              : 'What would you like to understand?'
          }
          className="w-full resize-y rounded-lg border border-line bg-surface p-4 font-serif text-base
            leading-relaxed text-text-primary placeholder:text-text-muted
            focus:border-accent focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={status === 'loading' || question.trim().length < 3}
            className="inline-flex min-h-[44px] items-center rounded-md bg-accent px-5 text-sm font-medium
              text-accent-contrast transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {status === 'loading' ? 'Finding relevant verses…' : 'Ask'}
          </button>

          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setMode(item.value);
                if (answer) void submit(question, item.value);
              }}
              className={cn(
                'inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm transition-colors',
                mode === item.value
                  ? 'border-accent bg-accent-muted text-accent'
                  : 'border-line text-text-secondary hover:border-line-strong',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </form>

      {!answer && status === 'idle' ? (
        <div className="mt-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Try
          </p>
          <ul className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => {
                    setQuestion(example);
                    void submit(example);
                  }}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4
                    text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-6 rounded-md border border-line bg-surface-sunken p-4 text-sm text-text-secondary">
          {error}
        </p>
      ) : null}

      {answer ? (
        <article className="mt-10" aria-live="polite">
          {/*
            A refusal is presented as a plain statement, not as an error and not
            dressed up as an answer. Saying "I cannot ground this" is the
            correct outcome, so it should not look like a failure.
          */}
          <div
            className={cn(
              'rounded-lg border p-6',
              isRefusal ? 'border-line bg-surface-sunken' : 'border-line bg-surface',
            )}
          >
            <p className="prose-reader whitespace-pre-line">{answer.answer}</p>
          </div>

          {answer.citations.length > 0 ? (
            <section className="mt-8">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Sources — {answer.citations.length} verse
                {answer.citations.length === 1 ? '' : 's'}
              </h2>
              <ul className="space-y-4">
                {answer.citations.map((citation) => (
                  <li key={citation.verse.id}>
                    <Link
                      href={`/gita/${citation.verse.chapterNumber}/${citation.verse.verseNumber}`}
                      className="group block rounded-lg border border-line bg-surface p-5 shadow-soft
                        transition-all hover:border-line-strong hover:shadow-card"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-sm text-accent">{citation.verse.ref}</span>
                        <span aria-hidden="true" className="text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
                          →
                        </span>
                      </div>
                      {citation.verse.sanskrit ? (
                        <p className="mb-2 line-clamp-2 font-devanagari text-lg leading-devanagari text-text-primary" lang="sa">
                          {citation.verse.sanskrit.split('\n')[0]}
                        </p>
                      ) : null}
                      {/* Quoted verbatim from the stored record, never from the model. */}
                      <p className="font-serif text-sm leading-relaxed text-text-secondary">
                        {citation.quotedText}
                      </p>
                      {citation.commentatorName || citation.sourceName ? (
                        <p className="mt-2 text-xs text-text-muted">
                          {[citation.commentatorName, citation.sourceName].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {answer.rejectedCitations.length > 0 ? (
            <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              {answer.rejectedCitations.length} reference
              {answer.rejectedCitations.length === 1 ? ' was' : 's were'} removed from this answer
              because {answer.rejectedCitations.length === 1 ? 'it' : 'they'} could not be matched
              to a verse in the library.
            </p>
          ) : null}

          {answer.followUpSuggestions.length > 0 ? (
            <div className="mt-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Follow up
              </p>
              <ul className="flex flex-wrap gap-2">
                {answer.followUpSuggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      onClick={() => {
                        setQuestion(suggestion);
                        void submit(suggestion);
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4
                        text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {answer.disclaimer ? (
            <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-text-muted">
              {answer.disclaimer}
            </p>
          ) : null}
        </article>
      ) : null}
    </div>
  );
}
