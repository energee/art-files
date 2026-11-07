import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const revalidate = false;

// A static index the browser searches itself: the site has no server to ask.
export const { staticGET: GET } = createFromSource(source);
