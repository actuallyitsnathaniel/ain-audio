import type {PortableTextBlock} from '@portabletext/types'

export type SanityImage = {
  _type?: 'image'
  asset?: {_ref?: string; _type?: 'reference'}
  alt?: string
}

export type SanitySite = {
  name?: string
  headline?: string
  description?: string
  about?: PortableTextBlock[]
  links?: Array<{label?: string; url?: string}>
  seo?: {title?: string; description?: string}
}

export type SanityAudioProject = {
  _id: string
  title: string
  slug: string
  subtitle?: string
  roles?: string[]
  summary?: string
  image?: SanityImage
  videos?: Array<{url?: string; aspectRatio?: string}>
}

export type SanityRelease = {
  _id: string
  title: string
  slug: string
  releaseType: 'single' | 'ep' | 'album' | 'pack'
  note?: string
  cover?: SanityImage
  links?: Array<{platform?: string; url?: string}>
  projectSlug?: string
}

export type SanityPress = {
  title: string
  source: string
  url: string
}

export type SanityPage = {
  title?: string
  summary?: string
  body?: PortableTextBlock[]
  seo?: {title?: string; description?: string}
}
