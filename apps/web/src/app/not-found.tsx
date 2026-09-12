import { ButtonLink, Container } from '@/components/ui';

export default function NotFound() {
  return (
    <Container width="prose">
      <div className="py-20 text-center">
        <p className="mb-4 text-sm uppercase tracking-widest text-gold-500">Not found</p>
        <h1 className="font-serif text-3xl text-text-primary">
          There is nothing at this address
        </h1>
        <p className="mx-auto mt-4 max-w-md leading-relaxed text-text-secondary">
          The Gita has eighteen chapters and seven hundred verses. If you were looking for one of
          them, the reference may have a typo.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <ButtonLink href="/gita">Browse chapters</ButtonLink>
          <ButtonLink href="/search" variant="secondary">
            Search
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
