import type { HtmlTagDescriptor, Plugin } from 'vite'

const LOCAL_URL = 'http://127.0.0.1:4102'
const URL_PLACEHOLDER = '__SITE_URL__'

export interface SiteEnv {
  /** Netlify build context: production, deploy-preview, branch-deploy, dev; "local" off Netlify. */
  context: string
  siteUrl: string
  indexable: boolean
  googleVerification?: string
}

/**
 * Netlify sets URL (primary domain) and DEPLOY_PRIME_URL (this deploy's URL) at build time.
 * Only production builds are indexable; previews, branch deploys and local builds say noindex.
 */
export function resolveSiteEnv(env: NodeJS.ProcessEnv = process.env): SiteEnv {
  const context = env.CONTEXT || 'local'
  const netlifyUrl = context === 'production' ? env.URL : env.DEPLOY_PRIME_URL
  const siteUrl = (netlifyUrl || LOCAL_URL).replace(/\/+$/, '')
  const googleVerification = env.GOOGLE_SITE_VERIFICATION?.trim() || undefined
  if (googleVerification && !/^[\w-]+$/.test(googleVerification)) {
    throw new Error('GOOGLE_SITE_VERIFICATION must be the token from Search Console (letters, digits, "-" and "_").')
  }
  return { context, siteUrl, indexable: context === 'production', googleVerification }
}

function jsonLd(siteUrl: string): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Meridian — Map Poster Studio',
    url: `${siteUrl}/`,
    description:
      'Turn any city into a printable map poster rendered from OpenStreetMap data, with 26 themes, per-layer colours and PNG export up to 8K.',
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript and HTML5 canvas.',
    image: `${siteUrl}/og-image.png`,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }
  // Keep "</script>" sequences impossible inside the inline script.
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function robotsTxt(site: SiteEnv): string {
  return site.indexable
    ? `User-agent: *\nAllow: /\n\nSitemap: ${site.siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'
}

export function sitemapXml(site: SiteEnv, lastmod = new Date().toISOString().slice(0, 10)): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${site.siteUrl}/</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    '  </url>',
    '</urlset>',
    '',
  ].join('\n')
}

/** Fills site URLs into index.html and emits robots.txt + sitemap.xml for the current Netlify context. */
export function seo(site: SiteEnv = resolveSiteEnv()): Plugin {
  return {
    name: 'meridian-seo',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const tags: HtmlTagDescriptor[] = []
        if (!site.indexable) {
          tags.push({ tag: 'meta', attrs: { name: 'robots', content: 'noindex' }, injectTo: 'head-prepend' })
        }
        if (site.googleVerification) {
          tags.push({
            tag: 'meta',
            attrs: { name: 'google-site-verification', content: site.googleVerification },
            injectTo: 'head',
          })
        }
        tags.push({ tag: 'script', attrs: { type: 'application/ld+json' }, children: jsonLd(site.siteUrl), injectTo: 'head' })
        return { html: html.replaceAll(URL_PLACEHOLDER, site.siteUrl), tags }
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(site) })
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(site) })
    },
  }
}
