import Head from 'next/head'
import styles from '@/styles/Home.module.css'
import { SearchDialog } from '@/components/SearchDialog'
import Image from 'next/image'
import Link from 'next/link'
import { SITE_NAME, SOURCE_URL } from '@/lib/site'

// Upstream declared `const inter = Inter({ subsets: ['latin'] })` from
// next/font/google here and never used it: it styled nothing, and made every
// build fetch the font from Google Fonts. It is gone.

export default function Home() {
  return (
    <>
      <Head>
        <title>{SITE_NAME}</title>
        <meta
          name="description"
          content="Next.js Template for building OpenAI applications with Supabase."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className={styles.main}>
        <div className={styles.center}>
          <SearchDialog />
        </div>

        <div className="py-8 w-full flex items-center justify-center space-x-6">
          <div className="opacity-75 transition hover:opacity-100 cursor-pointer">
            <Link href="https://supabase.com" className="flex items-center justify-center">
              <p className="text-base mr-2">Built by Supabase</p>
              <Image src={'/supabase.svg'} width="20" height="20" alt="Supabase logo" />
            </Link>
          </div>
          <div className="border-l border-gray-300 w-1 h-4" />
          <div className="flex items-center justify-center space-x-4">
            <div className="opacity-75 transition hover:opacity-100 cursor-pointer">
              <Link href={SOURCE_URL} className="flex items-center justify-center">
                <Image src={'/github.svg'} width="20" height="20" alt="Github logo" />
              </Link>
            </div>
            <div className="opacity-75 transition hover:opacity-100 cursor-pointer">
              <Link
                href="https://twitter.com/supabase"
                className="flex items-center justify-center"
              >
                <Image src={'/twitter.svg'} width="20" height="20" alt="Twitter logo" />
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
