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
import type {HireOffer, PressItem} from '../daw/data/site'
import {
  aboutParagraphs as localAbout,
  hireOffer as localHire,
  press as localPress,
  siteDescription as localSiteDescription,
  socials as localSocials,
} from '../daw/data/site'
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
  hireOffer: HireOffer
  socials: Socials
  siteDescription: string
}

const AudioContentContext = createContext<AudioContent | null>(null)

function mergeHire(remote: Partial<HireOffer> | undefined): HireOffer {
  if (!remote) return localHire
  return {
    headline: remote.headline || localHire.headline,
    lead: remote.lead || localHire.lead,
    produceMix: remote.produceMix || localHire.produceMix,
    mixOnly: remote.mixOnly || localHire.mixOnly,
    scope: remote.scope || localHire.scope,
    payment: remote.payment || localHire.payment,
  }
}

export function AudioContentProvider({children}: {children: ReactNode}) {
  const [ready, setReady] = useState(false)
  const [projects, setProjects] = useState(localProjects)
  const [discography, setDiscography] = useState(localDiscography)
  const [press, setPress] = useState(localPress)
  const [aboutParagraphs, setAbout] = useState(localAbout)
  const [hireOffer, setHireOffer] = useState(localHire)
  const [socials, setSocials] = useState(localSocials)
  const [siteDescription, setSiteDescription] = useState(localSiteDescription)

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
        if (remoteProjects.length) {
          const remoteIds = new Set(remoteProjects.map((p) => p.id))
          const extras = localProjects.filter((p) => !remoteIds.has(p.id))
          setProjects(extras.length ? [...remoteProjects, ...extras] : remoteProjects)
        }
        if (Object.keys(remoteDisco).length) {
          setDiscography({...localDiscography, ...remoteDisco})
        }
        if (remotePress.length) setPress(remotePress)
        if (site?.aboutParagraphs?.length) setAbout(site.aboutParagraphs.slice(0, 2))
        if (site?.hire) setHireOffer(mergeHire(site.hire))
        if (site?.seo?.description || site?.description) {
          setSiteDescription(site.seo?.description || site.description || localSiteDescription)
        }
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
            soundbetter: byLabel.soundbetter || localSocials.soundbetter,
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
    () => ({
      ready,
      projects,
      discography,
      press,
      aboutParagraphs,
      hireOffer,
      socials,
      siteDescription,
    }),
    [ready, projects, discography, press, aboutParagraphs, hireOffer, socials, siteDescription],
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
