// The guide is the site: no splash page in front of it.
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/docs');
}
