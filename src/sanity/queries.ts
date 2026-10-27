import {defineQuery} from 'groq'

export const AUDIO_SITE_QUERY = defineQuery(`*[_type == "site" && key == "audio"][0]{
  name, headline, description, about, links[]{label, url}, seo
}`)

export const AUDIO_PROJECTS_QUERY = defineQuery(`*[_type == "project" && discipline == "audio" && "site-audio" in sites[]._ref]
  | order(sortOrder asc){
    _id,
    title,
    "slug": slug.current,
    subtitle,
    roles,
    summary,
    image,
    videos[]{url, aspectRatio}
  }`)

export const AUDIO_RELEASES_QUERY = defineQuery(`*[_type == "release" && defined(project)]
  | order(sortOrder asc){
    _id,
    title,
    "slug": slug.current,
    releaseType,
    note,
    cover,
    links[]{platform, url},
    "projectSlug": project->slug.current
  }`)

export const AUDIO_PRESS_QUERY = defineQuery(`*[_type == "pressItem" && site._ref == "site-audio"] | order(_createdAt asc){
  title, source, url
}`)

export const AUDIO_POLICY_QUERY = defineQuery(`*[_type == "page" && slug.current == "usage-and-ai-policy"][0]{
  title, summary, body, seo
}`)
