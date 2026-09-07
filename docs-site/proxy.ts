import { NextRequest, NextResponse } from 'next/server';
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation';
import { docsContentRoute, docsRoute } from '@/lib/shared';

const { rewrite: rewriteDocs } = rewritePath(
  `${docsRoute}{/*path}`,
  `${docsContentRoute}{/*path}/content.md`,
);
const { rewrite: rewriteSuffix } = rewritePath(
  `${docsRoute}{/*path}.md`,
  `${docsContentRoute}{/*path}/content.md`,
);

export default function proxy(request: NextRequest) {
  const suffixPath = rewriteSuffix(request.nextUrl.pathname);
  if (suffixPath) {
    return NextResponse.rewrite(new URL(suffixPath, request.nextUrl));
  }

  if (!isMarkdownPreferred(request)) {
    return NextResponse.next();
  }

  const docsPath = rewriteDocs(request.nextUrl.pathname);
  if (!docsPath) {
    return NextResponse.next();
  }

  return NextResponse.rewrite(new URL(docsPath, request.nextUrl), {
    headers: { Vary: 'Accept' },
  });
}
