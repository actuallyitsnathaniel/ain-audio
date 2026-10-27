import {client} from './client'
import {mapAudioProjects, mapDiscography, mapPress, portableTextToParagraphs} from './map'
import {
  AUDIO_POLICY_QUERY,
  AUDIO_PRESS_QUERY,
  AUDIO_PROJECTS_QUERY,
  AUDIO_RELEASES_QUERY,
  AUDIO_SITE_QUERY,
} from './queries'
import type {SanityAudioProject, SanityPage, SanityPress, SanityRelease, SanitySite} from './types'

export async function fetchAudioSite() {
  const site = await client.fetch<SanitySite | null>(AUDIO_SITE_QUERY)
  if (!site) return null
  return {
    ...site,
    aboutParagraphs: portableTextToParagraphs(site.about as never),
  }
}

export async function fetchAudioProjects() {
  const docs = await client.fetch<SanityAudioProject[]>(AUDIO_PROJECTS_QUERY)
  return mapAudioProjects(docs)
}

export async function fetchDiscography() {
  const docs = await client.fetch<SanityRelease[]>(AUDIO_RELEASES_QUERY)
  return mapDiscography(docs)
}

export async function fetchPress() {
  const docs = await client.fetch<SanityPress[]>(AUDIO_PRESS_QUERY)
  return mapPress(docs)
}

export async function fetchPolicyPage() {
  return client.fetch<SanityPage | null>(AUDIO_POLICY_QUERY)
}
