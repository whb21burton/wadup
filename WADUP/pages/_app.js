import Head from 'next/head'
import '../styles/globals.css'

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <link rel="manifest" href="/manifest.json" />
        {/* There is no /favicon.ico in public/ — point the icon at a real
            file instead of 404ing on every page load. */}
        <link rel="icon" href="/icon-192.png" type="image/png" />
        {/* mobile-web-app-capable is the standard replacement; Chrome logs a
            deprecation warning for the apple- prefixed one on its own, but
            iOS Safari still only honours the apple- form, so keep both. */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="WadUp" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="theme-color" content="#050d1a" />
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{
            __html: `(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('https://utt.impactcdn.com/P-A7691820-e643-49f0-b60a-b1d1cb2a49c41.js','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');`,
          }}
        />
      </Head>
      <Component {...pageProps} />
    </>
  )
}
