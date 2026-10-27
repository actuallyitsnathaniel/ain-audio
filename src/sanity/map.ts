import type {DiscoEntry, PlatformLinkSet, ReleaseType} from '../daw/data/discography'
import type {Project, VimeoEmbed} from '../daw/data/projects'
import {projects as localProjects} from '../daw/data/projects'
import type {PressItem} from '../daw/data/site'
import {urlFor} from './image'
import type {SanityAudioProject, SanityPress, SanityRelease} from './types'

const projectIdFromSlug = (slug: string) => slug.replace(/^audio-/, '')

const RELEASE_TYPE: Record<string, ReleaseType> = {
  single: 'single',
  ep: 'ep',
  album: 'album',
  pack: 'general',
}

export function mapAudioProjects(remote: SanityAudioProject[]): Project[] {
  return remote.map((doc, index) => {
    const id = projectIdFromSlug(doc.slug)
    const local = localProjects.find((p) => p.id === id)
    const art =
      doc.image?.asset
        ? urlFor(doc.image).width(1200).height(1200).fit('crop').url()
        : local?.art ?? ''

    const vimeo: VimeoEmbed[] | undefined = doc.videos?.length
      ? doc.videos
          .filter((v): v is {url: string; aspectRatio?: string} => Boolean(v.url))
          .map((v) => ({src: v.url, ratio: v.aspectRatio || '16 / 9'}))
      : local?.vimeo

    return {
      id,
      artist: doc.title || local?.artist || id,
      subtitle: doc.subtitle || local?.subtitle || '',
      roles: doc.roles?.length ? doc.roles : local?.roles || [],
      art,
      color: local?.color ?? ['#8E7DE0', '#7D9BD1', '#5FB8A6', '#D1A05F', '#C97D7D'][index % 5],
      desc: doc.summary || local?.desc || '',
      vimeo,
    }
  })
}

export function mapDiscography(releases: SanityRelease[]): Record<string, DiscoEntry[]> {
  const out: Record<string, DiscoEntry[]> = {}
  for (const release of releases) {
    if (!release.projectSlug) continue
    const projectId = projectIdFromSlug(release.projectSlug)
    const links: PlatformLinkSet = {}
    for (const link of release.links || []) {
      if (!link.platform || !link.url) continue
      const platform = link.platform as keyof PlatformLinkSet
      links[platform] = link.url
    }
    const entry: DiscoEntry = {
      title: release.title,
      type: RELEASE_TYPE[release.releaseType] ?? 'general',
      art: release.cover?.asset
        ? urlFor(release.cover).width(800).height(800).fit('crop').url()
        : '',
      links,
      note: release.note,
    }
    ;(out[projectId] ||= []).push(entry)
  }
  return out
}

export function mapPress(items: SanityPress[]): PressItem[] {
  return items.map((item) => ({
    title: item.title,
    subtitle: item.source,
    href: item.url,
  }))
}

export function portableTextToParagraphs(
  blocks: Array<{_type?: string; children?: Array<{text?: string}>}> | undefined,
): string[] {
  if (!blocks?.length) return []
  return blocks
    .filter((b) => b._type === 'block')
    .map((b) => (b.children || []).map((c) => c.text || '').join(''))
    .filter(Boolean)
}
