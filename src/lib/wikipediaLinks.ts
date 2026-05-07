/** Wikipedia Special:Search — works without knowing exact article title. */
export function wikipediaSearchUrl(query: string): string {
  const q = query.trim()
  if (!q) return 'https://en.wikipedia.org/wiki/Main_Page'
  return `https://en.wikipedia.org/w/index.php?title=Special:Search&search=${encodeURIComponent(q)}`
}

/** Direct article URL when title is known (spaces → underscores). */
export function wikipediaArticleUrl(title: string): string {
  const t = title.trim().replace(/\s+/g, '_')
  if (!t) return wikipediaSearchUrl(title)
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(t).replace(/%2F/g, '/')}`
}
