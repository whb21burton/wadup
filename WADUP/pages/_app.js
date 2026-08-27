import Head from 'next/head'
import '../styles/globals.css'

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="WadUp" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="theme-color" content="#050d1a" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}
