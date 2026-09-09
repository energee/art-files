import Link from 'next/link';
import { docsRoute } from '@/lib/shared';

export default function HomePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <p className="mb-3 text-sm font-medium text-fd-muted-foreground">
        Label Lab
      </p>
      <h1 className="mb-4 text-3xl font-semibold tracking-tight">
        Make the can look like you meant it
      </h1>
      <p className="mb-8 text-fd-muted-foreground">
        You fill a master. Label Lab builds the art PDF and the white-ink
        plate, registered, at print DPI. Same geometry for Photoshop if a
        designer needs a pass.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={docsRoute}
          className="inline-flex items-center rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
        >
          Read the guide
        </Link>
        <Link
          href={`${docsRoute}/getting-started`}
          className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium"
        >
          Fire it up
        </Link>
      </div>
    </div>
  );
}
