import { sound_xyz_url, sound_xyz_key } from "./util";

/** Riley's artist ID */
const rileyXYZId = "a3c5a81e-f15e-4300-a4f3-ae03846e60a9";

/** GraphQL query */
const query = `
query AllArtistReleases {
  artist(id: "${rileyXYZId}") {
    id
    user {
      id
    }
    numReleases(filter: {
      releaseAuthor: ALL,
      creditSplit: ALL,
      releaseAlbumRevealStatus: ALL
    })
    releases(pagination: {
      first: 20
    }, filter: {
      releaseAuthor: ALL,
      creditSplit: ALL,
      releaseAlbumRevealStatus: ALL
    }) {
      edges {
        node {
          title
          id
          artist {
            name
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`;

/**
 * @typedef {Object} Artist
 * @property {string} name - The artist's name.
 * @property {string} id - The artist's ID.
 */

/**
 * @typedef {Object} ReleaseNode
 * @property {string} title - The release title.
 * @property {string} id - The release ID.
 * @property {Artist} artist - The artist information.
 */

/**
 * @typedef {Object} ReleaseEdge
 * @property {ReleaseNode} node - The release node.
 */

/**
 * @typedef {Object} PageInfo
 * @property {boolean} hasNextPage - Indicates if there are more pages.
 * @property {string|null} endCursor - The cursor for the next page.
 */

/**
 * @typedef {Object} ReleasesResponse
 * @property {Object} data - The main data object.
 * @property {Object} data.artist - Artist details.
 * @property {Object} data.artist.releases - Releases object.
 * @property {ReleaseEdge[]} data.artist.releases.edges - List of releases.
 * @property {PageInfo} data.artist.releases.pageInfo - Pagination information.
 */

let cachedReleases: Promise<ReleaseEdge[]> | null = null;

/**
 * Fetches sound.xyz songs with caching.
 * @returns {Promise<ReleaseEdge[]>} A promise that resolves to an array of releases.
 */
const getSoundXYZSongs = async (): Promise<ReleaseEdge[]> => {
  try {
    console.log("DOES THIS WORK: ", sound_xyz_url);
    const response = await fetch(sound_xyz_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sound-Client-Key": sound_xyz_key,
      },
      body: JSON.stringify({ query }),
    });

    const data = /** @type {ReleasesResponse} */ await response.json();
    return data.data.artist.releases.edges;
  } catch (error) {
    console.error("Error:", error);
    return [];
  }
};

/**
 * Gets cached sound.xyz releases or fetches them if not cached.
 * @returns {Promise<ReleaseEdge[]>} A promise that resolves to an array of releases.
 */
export const getSoundXyzReleases = (): Promise<ReleaseEdge[]> => {
  if (!cachedReleases) {
    cachedReleases = getSoundXYZSongs();
  }
  return cachedReleases;
};

/** @deprecated Use getSoundXyzReleases() instead */
export const soundXyzReleases = getSoundXyzReleases();
