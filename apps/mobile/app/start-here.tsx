import { View } from 'react-native';

import { Body, Card, Heading, Screen, useTypeScale } from '@/components/ui';

/**
 * Beginner orientation.
 *
 * Mirrors the website copy. Where a claim belongs to the tradition rather than
 * to established history, it says which — that distinction is more respectful
 * than blurring it in either direction.
 */
const SECTIONS = [
  {
    title: 'What is the Bhagavad Gita?',
    body: 'A conversation of about seven hundred verses, set on a battlefield in the moments before a war begins. It sits inside the Mahabharata and is usually read on its own. The whole text is a dialogue: a soldier who cannot bring himself to fight, and his charioteer, who answers him.',
  },
  {
    title: 'Who is Arjuna?',
    body: 'The third of the five Pandava brothers and the finest archer of his generation. He is not a doubter by temperament, which is what makes his collapse at the opening significant. The people on the other side of the field are his cousins, his teachers and his grandfather.',
  },
  {
    title: 'Who is Krishna?',
    body: "Arjuna's charioteer, friend and kinsman. Within the tradition Krishna is understood as an avatara, a descent of the divine into the world, and the Gita has him say as much of himself. Read as literature he is the voice that answers Arjuna; read within the tradition he is considerably more. The text supports both readings.",
  },
  {
    title: 'What is Kurukshetra?',
    body: "The plain where the war of the Mahabharata is fought, in what is now Haryana. The Gita's first line calls it dharmakshetra, the field of dharma, before it calls it Kurukshetra. Whether the war corresponds to a historical event, and if so when, is genuinely unsettled; the text makes no claim about that.",
  },
  {
    title: 'Why was Arjuna conflicted?',
    body: 'Not from cowardice. He is caught between obligations that both genuinely bind him: the duty of a warrior in a just war, and the duty owed to family and teachers. Whichever he chooses, he violates something real. That is the problem the rest of the Gita responds to.',
  },
  {
    title: 'How to read it',
    body: 'Slowly, and not necessarily in order. Chapter 2 carries most of the central argument. Chapter 12 is short and approachable. Chapter 18 gathers everything together. If you would rather go straight in, start at 1.1 and keep going.',
  },
  {
    title: 'Words worth knowing first',
    body: 'Dharma — what is genuinely yours to do. Karma — action, and what follows from it. Atman — the self, as distinct from the body. Yoga — a discipline that joins, not a set of postures. Moksha — release. Each has a glossary entry, and none has a clean English equivalent.',
  },
];

export default function StartHereScreen() {
  const type = useTypeScale();
  return (
    <Screen>
      <View style={{ paddingTop: 12, gap: 16 }}>
        <Heading level={2}>New to the Gita</Heading>
        <Body>
          Enough context to open the text without feeling lost. Nothing here assumes prior
          knowledge of Indian philosophy.
        </Body>
        {SECTIONS.map((section) => (
          <Card key={section.title}>
            <Body style={{ fontWeight: '600', fontSize: type.title, marginBottom: 8 }}>
              {section.title}
            </Body>
            <Body>{section.body}</Body>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
