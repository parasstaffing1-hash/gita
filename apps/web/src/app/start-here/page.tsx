import type { Metadata } from 'next';

import { ButtonLink, Card, Container, Divider } from '@/components/ui';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: 'New to the Bhagavad Gita? Start Here',
  description:
    'What the Bhagavad Gita is, who Krishna and Arjuna are, what happened at Kurukshetra, ' +
    'and how to begin reading it.',
  path: '/start-here',
});

/**
 * Beginner orientation.
 *
 * Where a statement belongs to the traditional narrative rather than to
 * externally established history, this page says which it is. Blurring that
 * line in either direction would be a disservice — to a reader who wants the
 * tradition on its own terms, and to one who wants to know what is settled.
 */
const SECTIONS = [
  {
    title: 'What is the Bhagavad Gita?',
    body: `A conversation of about seven hundred verses, set on a battlefield in the moments before a war begins. It sits inside the Mahabharata, one of the two great Sanskrit epics, and is usually read on its own. The whole text is a dialogue: a soldier who cannot bring himself to fight, and his charioteer, who answers him.`,
  },
  {
    title: 'Who is Arjuna?',
    body: `The third of the five Pandava brothers and the finest archer of his generation. He is not a doubter by temperament, which is what makes his collapse at the opening of the Gita significant. The people on the other side of the field are his cousins, his teachers and his grandfather.`,
  },
  {
    title: 'Who is Krishna?',
    body: `Arjuna's charioteer, friend and kinsman. Within the tradition Krishna is understood as an avatara, a descent of the divine into the world, and the Gita has him say as much of himself. Read as literature, he is the voice that answers Arjuna; read within the tradition, he is considerably more than that. The text supports both readings and does not ask you to settle the question before you begin.`,
  },
  {
    title: 'What is Kurukshetra?',
    body: `The plain where the war of the Mahabharata is fought, in what is now Haryana in northern India. The Gita's first line calls it dharmakshetra, the field of dharma, before it calls it Kurukshetra — a pairing that commentators have been reading meaning into ever since. Whether the war described corresponds to a historical event, and if so when, is genuinely unsettled; the text itself makes no claim about that.`,
  },
  {
    title: 'Why was Arjuna conflicted?',
    body: `Not from cowardice. He is caught between obligations that both genuinely bind him: the duty of a warrior in a just war, and the duty owed to family and teachers. Whichever he chooses, he violates something real. That is the problem the rest of the Gita responds to, and it is why the text keeps being useful to people nowhere near a battlefield.`,
  },
  {
    title: 'Its place in the Mahabharata',
    body: `The Gita occupies chapters 23 to 40 of the Bhishma Parva, the sixth book of the Mahabharata. Scholarly estimates for its composition generally fall somewhere between the fifth and second centuries BCE, though the dating is contested and the text may have grown in layers. It has been copied, recited and commented on as a self-contained work for a very long time.`,
  },
  {
    title: 'How to read it',
    body: `Slowly, and not necessarily in order. Chapter 2 carries most of the central argument. Chapter 12 is short and unusually approachable. Chapter 18 gathers everything together. If you want a path, the seven-day plan takes one or two verses a day and asks a question about each. If you would rather go straight to the text, start at 1.1 and keep going.`,
  },
  {
    title: 'A few words worth knowing first',
    body: `Dharma — what is genuinely yours to do. Karma — action, and what follows from it. Atman — the self, as distinct from the body. Yoga — a discipline that joins, not a set of postures. Moksha — release. Each has a glossary entry, and none has a clean English equivalent, which is why they are usually left untranslated.`,
  },
];

export default function StartHerePage() {
  return (
    <Container width="prose">
      <header className="mb-10">
        <p className="mb-3 text-sm uppercase tracking-widest text-gold-500">Start here</p>
        <h1 className="font-serif text-4xl text-text-primary">New to the Gita</h1>
        <p className="mt-4 leading-relaxed text-text-secondary">
          Enough context to open the text without feeling lost. Nothing here assumes you know
          anything about Indian philosophy.
        </p>
      </header>

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <Card key={section.title} as="section">
            <h2 className="mb-3 font-serif text-xl text-text-primary">{section.title}</h2>
            <p className="prose-reader">{section.body}</p>
          </Card>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/reading-plans/7-day-introduction">Take the 7-day introduction</ButtonLink>
        <ButtonLink href="/gita/1/1" variant="secondary">
          Start at verse 1.1
        </ButtonLink>
      </div>

      <Divider ornament />

      <p className="text-sm leading-relaxed text-text-muted">
        Where this page describes what the tradition holds, it says so. Where a historical question
        is genuinely open — the dating of the text, the historicity of the war — it says that too,
        rather than presenting either as settled.
      </p>
    </Container>
  );
}
