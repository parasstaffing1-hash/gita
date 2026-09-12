/**
 * Structured data.
 *
 * The single place in the app that writes a raw <script> body. It accepts only
 * objects built by `@/lib/seo` from typed API data, serialises them with
 * JSON.stringify, and escapes `<` so a value can never close the script tag.
 * No caller-supplied markup, and no user-authored string, reaches it.
 */
export function JsonLd({ data }: { data: unknown }) {
  const json = JSON.stringify(data).replace(/</g, '\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
