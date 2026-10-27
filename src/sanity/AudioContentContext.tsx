import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {DiscoEntry} from '../daw/data/discography'
import {discography as localDiscography} from '../daw/data/discography'
import type {Project} from '../daw/data/projects'
import {projects as localProjects} from '../daw/data/projects'
import type {PressItem} from '../daw/data/site'
import {aboutParagraphs as localAbout, press as localPress, socials as localSocials} from '../daw/data/site'
import {
  fetchAudioProjects,
  fetchAudioSite,
  fetchDiscography,
  fetchPress,
} from './fetch'

type Socials = typeof localSocials

type AudioContent = {
  ready: boolean
  projects: Project[]
  discography: Record<string, DiscoEntry[]>
  press: PressItem[]
  aboutParagraphs: string[]
  socials: Socials
  siteDescription?: string
}

const AudioContentContext = createContext<AudioContent | null>(null)

export function AudioContentProvider({children}: {children: ReactNode}) {
  const [ready, setReady] = useState(false)
  const [projects, setProjects] = useState(localProjects)
  const [discography, setDiscography] = useState(localDiscography)
  const [press, setPress] = useState(localPress)
  const [aboutParagraphs, setAbout] = useState(localAbout)
  const [socials, setSocials] = useState(localSocials)
  const [siteDescription, setSiteDescription] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [site, remoteProjects, remoteDisco, remotePress] = await Promise.all([
          fetchAudioSite(),
          fetchAudioProjects(),
          fetchDiscography(),
          fetchPress(),
        ])
        if (cancelled) return
        if (remoteProjects.length) setProjects(remoteProjects)
        if (Object.keys(remoteDisco).length) setDiscography(remoteDisco)
        if (remotePress.length) setPress(remotePress)
        if (site?.aboutParagraphs?.length) setAbout(site.aboutParagraphs)
        if (site?.description) setSiteDescription(site.description)
        if (site?.links?.length) {
          const byLabel = Object.fromEntries(
            site.links
              .filter((l) => l.label && l.url)
              .map((l) => [l.label!.toLowerCase(), l.url!]),
          )
          setSocials({
            email: byLabel.email || localSocials.email,
            instagram: byLabel.instagram || localSocials.instagram,
            youtube: byLabel.youtube || localSocials.youtube,
            spotify: byLabel.spotify || localSocials.spotify,
          })
        }
      } catch (error) {
        console.warn('[sanity] using local audio content fallback', error)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(
    () => ({ready, projects, discography, press, aboutParagraphs, socials, siteDescription}),
    [ready, projects, discography, press, aboutParagraphs, socials, siteDescription],
  )

  return (
    <AudioContentContext.Provider value={value}>{children}</AudioContentContext.Provider>
  )
}

export function useAudioContent() {
  const ctx = useContext(AudioContentContext)
  if (!ctx) {
    throw new Error('useAudioContent must be used within AudioContentProvider')
  }
  return ctx
}
